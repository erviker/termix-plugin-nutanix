import type {
  PluginContext,
  PluginHostSummary,
} from "@termix-ssh/plugin-sdk/backend";
import type {
  NutanixCluster,
  NutanixConfig,
  NutanixHost,
  NutanixStatusResponse,
  NutanixStorageContainer,
  NutanixSummary,
  NutanixVm,
} from "./types.js";

const CACHE_TTL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 15_000;
export const VALID_VM_UUID_RE = /^[a-zA-Z0-9-]+$/;

interface CacheEntry {
  key: string;
  expiresAt: number;
  data: NutanixStatusResponse;
}

let cachedStatus: CacheEntry | null = null;

export function clearInventoryCache(): void {
  cachedStatus = null;
}

export function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\/+$/, "");
}

export async function readConfig(ctx: PluginContext): Promise<NutanixConfig> {
  const [prismUrl, peUrl, username, password, allowInsecureTls, defaultFolder] =
    await Promise.all([
      ctx.settings.get<string>("prismUrl"),
      ctx.settings.get<string>("peUrl"),
      ctx.settings.get<string>("username"),
      ctx.settings.get<string>("password"),
      ctx.settings.get<boolean>("allowInsecureTls"),
      ctx.settings.get<string>("defaultFolder"),
    ]);

  return {
    prismUrl: normalizeBaseUrl(prismUrl),
    peUrl: normalizeBaseUrl(peUrl),
    username: typeof username === "string" ? username.trim() : "",
    password: typeof password === "string" ? password : "",
    allowInsecureTls: Boolean(allowInsecureTls),
    defaultFolder:
      typeof defaultFolder === "string" && defaultFolder.trim()
        ? defaultFolder.trim()
        : "Nutanix VMs",
  };
}

export function isConfigured(config: NutanixConfig): boolean {
  return Boolean(config.prismUrl && config.username && config.password);
}

function emptySummary(): NutanixSummary {
  return {
    clusterCount: 0,
    hostCount: 0,
    containerCount: 0,
    vmCount: 0,
    runningVms: 0,
    stoppedVms: 0,
    totalMemoryBytes: 0,
    usedMemoryBytes: 0,
    totalStorageBytes: 0,
    usedStorageBytes: 0,
  };
}

export function emptyStatus(config: NutanixConfig): NutanixStatusResponse {
  return {
    configured: false,
    prismUrl: config.prismUrl,
    peUrl: config.peUrl,
    fetchedAt: new Date().toISOString(),
    summary: emptySummary(),
    clusters: [],
    hosts: [],
    containers: [],
    vms: [],
  };
}

export async function prismRequest<T = Record<string, unknown>>(
  ctx: PluginContext,
  baseUrl: string,
  config: NutanixConfig,
  method: string,
  pathname: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid Nutanix endpoint URL: ${baseUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported Nutanix URL protocol: ${parsed.protocol}`);
  }

  const credentials = Buffer.from(
    `${config.username}:${config.password}`,
  ).toString("base64");

  const headers: Record<string, string> = {
    Authorization: `Basic ${credentials}`,
    Accept: "application/json",
  };
  let encodedBody: string | undefined;
  if (body !== undefined) {
    encodedBody = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }

  if (signal?.aborted) {
    throw new Error("Request aborted");
  }

  const response = await ctx.fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: encodedBody,
    timeoutMs: REQUEST_TIMEOUT_MS,
    allowPrivateHosts: [parsed.hostname],
    ...(config.allowInsecureTls ? { tls: { rejectUnauthorized: false } } : {}),
  });

  if (signal?.aborted) {
    throw new Error("Request aborted");
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    const suffix = errText ? `: ${errText.slice(0, 200)}` : "";
    throw new Error(
      `Nutanix API ${method} ${pathname} failed with HTTP ${response.status}${suffix}`,
    );
  }

  const rawText = await response.text();
  return (rawText ? JSON.parse(rawText) : {}) as T;
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismEntity = Record<string, any>;

function asArray<T = PrismEntity>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function matchTermixHost(
  vmName: string,
  ipList: string[],
  hostsByIp: Map<string, PluginHostSummary>,
  hostsByName: Map<string, PluginHostSummary>,
): PluginHostSummary | undefined {
  for (const ip of ipList) {
    const match = hostsByIp.get(ip);
    if (match) return match;
  }
  return hostsByName.get(vmName.toLowerCase());
}

export async function collectInventory(
  ctx: PluginContext,
  options?: { force?: boolean; signal?: AbortSignal },
): Promise<NutanixStatusResponse> {
  const config = await readConfig(ctx);
  if (!isConfigured(config)) {
    return emptyStatus(config);
  }

  const cacheKey = `${config.prismUrl}|${config.peUrl}|${config.username}`;
  if (
    !options?.force &&
    cachedStatus &&
    cachedStatus.key === cacheKey &&
    cachedStatus.expiresAt > Date.now()
  ) {
    return cachedStatus.data;
  }

  const v3ListBody = (length: number) => ({
    kind: undefined,
    length,
  });

  const [clustersRes, hostsRes, vmsRes, termixHosts] = await Promise.all([
    prismRequest<{ entities?: Record<string, any>[] }>(
      ctx,
      config.prismUrl,
      config,
      "POST",
      "/api/nutanix/v3/clusters/list",
      v3ListBody(100),
      options?.signal,
    ),
    prismRequest<{ entities?: Record<string, any>[] }>(
      ctx,
      config.prismUrl,
      config,
      "POST",
      "/api/nutanix/v3/hosts/list",
      v3ListBody(200),
      options?.signal,
    ),
    prismRequest<{ entities?: Record<string, any>[] }>(
      ctx,
      config.prismUrl,
      config,
      "POST",
      "/api/nutanix/v3/vms/list",
      v3ListBody(500),
      options?.signal,
    ),
    ctx.hosts.list().catch(() => [] as PluginHostSummary[]),
  ]);

  let peHostsRaw: Record<string, any>[] = [];
  let peContainersRaw: Record<string, any>[] = [];
  if (config.peUrl) {
    const [peHostsResult, peContainersResult] = await Promise.allSettled([
      prismRequest<{ entities?: Record<string, any>[] }>(
        ctx,
        config.peUrl,
        config,
        "GET",
        "/PrismGateway/services/rest/v2.0/hosts/",
        undefined,
        options?.signal,
      ),
      prismRequest<{ entities?: Record<string, any>[] }>(
        ctx,
        config.peUrl,
        config,
        "GET",
        "/PrismGateway/services/rest/v2.0/storage_containers/",
        undefined,
        options?.signal,
      ),
    ]);
    if (peHostsResult.status === "fulfilled") {
      peHostsRaw = asArray(peHostsResult.value.entities);
    }
    if (peContainersResult.status === "fulfilled") {
      peContainersRaw = asArray(peContainersResult.value.entities);
    }
  }

  const clusterNameByUuid = new Map<string, string>();
  const clusters: NutanixCluster[] = asArray<PrismEntity>(clustersRes.entities)
    .filter((entity) => {
      const services = asArray<string>(
        entity.status?.resources?.config?.service_list ??
          entity.spec?.resources?.config?.service_list,
      );
      return !services.includes("PRISM_CENTRAL");
    })
    .map((entity) => {
      const uuid = toString(entity.metadata?.uuid);
      const name = toString(
        entity.status?.name ?? entity.spec?.name,
        uuid || "Cluster",
      );
      if (uuid) clusterNameByUuid.set(uuid, name);
      const res = entity.status?.resources ?? entity.spec?.resources ?? {};
      const network = res.network ?? {};
      const nodes = asArray(res.nodes?.hypervisor_server_list);
      const services = asArray<string>(res.config?.service_list);
      return {
        uuid,
        name,
        aosVersion: toString(res.config?.software_map?.NOS?.version, "unknown"),
        externalIp: toString(network.external_ip),
        nodeCount: nodes.length,
        services,
      };
    });

  const peHostByUuid = new Map<string, Record<string, any>>();
  for (const peHost of peHostsRaw) {
    const uuid = toString(peHost.uuid);
    if (uuid) peHostByUuid.set(uuid, peHost);
  }

  let totalMemoryBytes = 0;
  let usedMemoryBytes = 0;

  const hosts: NutanixHost[] = asArray<PrismEntity>(hostsRes.entities).map(
    (entity) => {
      const uuid = toString(entity.metadata?.uuid);
      const res = entity.status?.resources ?? entity.spec?.resources ?? {};
      const peHost = peHostByUuid.get(uuid);
      const clusterUuid = toString(
        entity.status?.cluster_reference?.uuid ??
          entity.spec?.cluster_reference?.uuid ??
          peHost?.cluster_uuid,
      );
      const memoryBytes = toNumber(
        peHost?.memory_capacity_in_bytes ??
          toNumber(res.memory_capacity_mib) * 1024 * 1024,
      );
      const memPpm = peHost?.usage_stats?.["hypervisor_memory_usage_ppm"];
      const cpuPpm = peHost?.usage_stats?.["hypervisor_cpu_usage_ppm"];
      const memoryUsagePct =
        memPpm !== undefined ? Math.round(toNumber(memPpm) / 10_000) : null;
      const cpuUsagePct =
        cpuPpm !== undefined ? Math.round(toNumber(cpuPpm) / 10_000) : null;

      totalMemoryBytes += memoryBytes;
      if (memoryUsagePct !== null && memoryBytes > 0) {
        usedMemoryBytes += Math.round((memoryBytes * memoryUsagePct) / 100);
      }

      return {
        uuid,
        name: toString(
          entity.status?.name ?? entity.spec?.name ?? peHost?.name,
          uuid,
        ),
        clusterName:
          toString(entity.status?.cluster_reference?.name) ||
          clusterNameByUuid.get(clusterUuid) ||
          "",
        controllerIp: toString(
          peHost?.controller_vm_backplane_ip ?? res.controller_vm?.ip,
        ),
        hypervisorVersion: toString(
          peHost?.hypervisor_full_name ??
            res.hypervisor?.hypervisor_full_name ??
            res.hypervisor?.type,
          "AHV",
        ),
        numCpuCores: toNumber(peHost?.num_cpu_cores ?? res.num_cpu_cores),
        numCpuSockets: toNumber(peHost?.num_cpu_sockets ?? res.num_cpu_sockets),
        memoryBytes,
        cpuUsagePct,
        memoryUsagePct,
        numVms: toNumber(peHost?.num_vms ?? res.num_vms),
        serial: toString(peHost?.serial ?? res.serial_number),
      };
    },
  );

  let totalStorageBytes = 0;
  let usedStorageBytes = 0;

  const containers: NutanixStorageContainer[] = peContainersRaw.map((item) => {
    const stats = item.usage_stats ?? {};
    const capacityBytes = toNumber(
      stats["storage.user_capacity_bytes"] ?? item.max_capacity,
    );
    const usedBytes = toNumber(stats["storage.user_usage_bytes"]);
    const freeBytes = toNumber(
      stats["storage.user_free_bytes"],
      Math.max(0, capacityBytes - usedBytes),
    );
    const usagePct =
      capacityBytes > 0 ? Math.round((usedBytes / capacityBytes) * 100) : null;

    totalStorageBytes += capacityBytes;
    usedStorageBytes += usedBytes;

    return {
      uuid: toString(item.storage_container_uuid ?? item.id),
      name: toString(item.name, "Container"),
      clusterUuid: toString(item.cluster_uuid),
      replicationFactor: toNumber(item.replication_factor, 2),
      compressionEnabled: Boolean(item.compression_enabled),
      capacityBytes,
      usedBytes,
      freeBytes,
      usagePct,
    };
  });

  const hostsByIp = new Map<string, PluginHostSummary>();
  const hostsByName = new Map<string, PluginHostSummary>();
  for (const host of termixHosts) {
    if (host.ip) hostsByIp.set(host.ip.trim(), host);
    if (host.name) hostsByName.set(host.name.trim().toLowerCase(), host);
  }

  let runningVms = 0;
  let stoppedVms = 0;

  const vms: NutanixVm[] = asArray<PrismEntity>(vmsRes.entities).map(
    (entity) => {
      const uuid = toString(entity.metadata?.uuid);
      const res = entity.status?.resources ?? entity.spec?.resources ?? {};
      const name = toString(entity.status?.name ?? entity.spec?.name, uuid);
      const powerState = toString(res.power_state, "UNKNOWN").toUpperCase();
      if (powerState === "ON") runningVms += 1;
      else if (powerState === "OFF") stoppedVms += 1;

      const ipList: string[] = [];
      for (const nic of asArray<Record<string, any>>(res.nic_list)) {
        for (const endpoint of asArray<Record<string, any>>(
          nic.ip_endpoint_list,
        )) {
          const ip = toString(endpoint.ip).trim();
          if (ip && !ipList.includes(ip)) ipList.push(ip);
        }
      }

      const numSockets = toNumber(res.num_sockets, 1);
      const vcpusPerSocket = toNumber(res.num_vcpus_per_socket, 1);
      const clusterUuid = toString(
        entity.status?.cluster_reference?.uuid ??
          entity.spec?.cluster_reference?.uuid,
      );
      const linked = matchTermixHost(name, ipList, hostsByIp, hostsByName);

      return {
        uuid,
        name,
        description: toString(
          entity.status?.description ?? entity.spec?.description,
        ),
        clusterName:
          toString(entity.status?.cluster_reference?.name) ||
          clusterNameByUuid.get(clusterUuid) ||
          "",
        hostName: toString(res.host_reference?.name),
        powerState,
        numVcpus: Math.max(1, numSockets * vcpusPerSocket),
        memoryMb: toNumber(res.memory_size_mib),
        ipList,
        primaryIp: ipList.find((ip) => ip.includes(".")) ?? ipList[0] ?? null,
        linkedHostId: linked ? linked.id : null,
        linkedHostName: linked ? linked.name : null,
      };
    },
  );

  const payload: NutanixStatusResponse = {
    configured: true,
    prismUrl: config.prismUrl,
    peUrl: config.peUrl,
    fetchedAt: new Date().toISOString(),
    summary: {
      clusterCount: clusters.length,
      hostCount: hosts.length,
      containerCount: containers.length,
      vmCount: vms.length,
      runningVms,
      stoppedVms,
      totalMemoryBytes,
      usedMemoryBytes,
      totalStorageBytes,
      usedStorageBytes,
    },
    clusters,
    hosts,
    containers,
    vms,
  };

  cachedStatus = {
    key: cacheKey,
    expiresAt: Date.now() + CACHE_TTL_MS,
    data: payload,
  };

  return payload;
}

export async function setVmPowerState(
  ctx: PluginContext,
  uuid: string,
  state: "ON" | "OFF",
  signal?: AbortSignal,
  request?: unknown,
): Promise<{ uuid: string; name: string; state: "ON" | "OFF" }> {
  if (!VALID_VM_UUID_RE.test(uuid)) {
    throw new Error("Invalid Nutanix VM UUID");
  }
  const config = await readConfig(ctx);
  if (!isConfigured(config)) {
    throw new Error("Nutanix Prism Central is not configured");
  }

  const current = await prismRequest<Record<string, any>>(
    ctx,
    config.prismUrl,
    config,
    "GET",
    `/api/nutanix/v3/vms/${encodeURIComponent(uuid)}`,
    undefined,
    signal,
  );

  const vmName = toString(current.status?.name ?? current.spec?.name, uuid);
  const nextSpec = structuredClone(current.spec ?? {});
  nextSpec.resources = {
    ...(nextSpec.resources ?? {}),
    power_state: state,
  };

  const payload = {
    api_version: current.api_version ?? "3.1",
    metadata: current.metadata ?? { kind: "vm", uuid },
    spec: nextSpec,
  };

  await prismRequest(
    ctx,
    config.prismUrl,
    config,
    "PUT",
    `/api/nutanix/v3/vms/${encodeURIComponent(uuid)}`,
    payload,
    signal,
  );

  clearInventoryCache();

  await ctx.audit.record({
    action: "nutanix.vm.power",
    resourceType: "nutanix_vm",
    resourceId: uuid,
    resourceName: vmName,
    details: JSON.stringify({ state }),
    success: true,
    request,
  });

  return { uuid, name: vmName, state };
}
