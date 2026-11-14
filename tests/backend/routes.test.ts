import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import express, { type Router } from "express";
import {
  createMockCtx,
  type FakeContextOptions,
  type MockPluginContext,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activate, deactivate } from "../../src/backend/index.js";

const manifest = manifestJson as unknown as PluginManifest;

const SAMPLE_CLUSTERS = {
  entities: [
    {
      metadata: { uuid: "pc-uuid-0001" },
      status: {
        name: "Prism Central",
        resources: {
          config: {
            service_list: ["PRISM_CENTRAL"],
            software_map: { NOS: { version: "pc.2024.3" } },
          },
          network: { external_ip: "10.0.0.10" },
          nodes: { hypervisor_server_list: [] },
        },
      },
    },
    {
      metadata: { uuid: "cluster-uuid-0001" },
      status: {
        name: "prod-ahv-01",
        resources: {
          config: {
            service_list: ["AOS", "PRISM_ELEMENT"],
            software_map: { NOS: { version: "6.8.1" } },
          },
          network: { external_ip: "10.0.0.11" },
          nodes: { hypervisor_server_list: [{ ip: "10.0.0.12" }] },
        },
      },
    },
  ],
};

const SAMPLE_HOSTS = {
  entities: [
    {
      metadata: { uuid: "ahv-host-0001" },
      status: {
        name: "ahv-node-01",
        cluster_reference: { uuid: "cluster-uuid-0001", name: "prod-ahv-01" },
        resources: {
          controller_vm: { ip: "10.0.0.21" },
          hypervisor: { hypervisor_full_name: "AHV 20230302.100" },
          num_cpu_cores: 32,
          num_cpu_sockets: 2,
          memory_capacity_mib: 262144,
          num_vms: 2,
          serial_number: "SN-AHV-01",
        },
      },
    },
  ],
};

let lastPutBody: Record<string, unknown> | null = null;

const SAMPLE_VMS = {
  entities: [
    {
      metadata: { uuid: "vm-uuid-0001", kind: "vm", spec_version: 3 },
      api_version: "3.1",
      spec: {
        name: "web-01",
        resources: { power_state: "ON" },
      },
      status: {
        name: "web-01",
        cluster_reference: { uuid: "cluster-uuid-0001", name: "prod-ahv-01" },
        resources: {
          power_state: "ON",
          num_sockets: 2,
          num_vcpus_per_socket: 2,
          memory_size_mib: 8192,
          host_reference: { name: "ahv-node-01" },
          nic_list: [
            { ip_endpoint_list: [{ ip: "10.10.10.20" }] },
            { ip_endpoint_list: [{ ip: "10.0.1.50" }] },
          ],
        },
      },
    },
    {
      metadata: { uuid: "vm-uuid-0002", kind: "vm", spec_version: 1 },
      api_version: "3.1",
      spec: {
        name: "DB-01",
        resources: { power_state: "OFF" },
      },
      status: {
        name: "DB-01",
        cluster_reference: { uuid: "cluster-uuid-0001", name: "prod-ahv-01" },
        resources: {
          power_state: "OFF",
          num_sockets: 4,
          num_vcpus_per_socket: 1,
          memory_size_mib: 16384,
          host_reference: { name: "ahv-node-01" },
          nic_list: [{ ip_endpoint_list: [{ ip: "10.0.1.60" }] }],
        },
      },
    },
    {
      metadata: { uuid: "vm-uuid-0003", kind: "vm", spec_version: 2 },
      api_version: "3.1",
      spec: {
        name: "worker-new",
        resources: { power_state: "ON" },
      },
      status: {
        name: "worker-new",
        cluster_reference: { uuid: "cluster-uuid-0001", name: "prod-ahv-01" },
        resources: {
          power_state: "ON",
          num_sockets: 1,
          num_vcpus_per_socket: 2,
          memory_size_mib: 4096,
          host_reference: { name: "ahv-node-01" },
          nic_list: [{ ip_endpoint_list: [{ ip: "10.0.1.70" }] }],
        },
      },
    },
  ],
};

const SAMPLE_PE_HOSTS = {
  entities: [
    {
      uuid: "ahv-host-0001",
      name: "ahv-node-01",
      cluster_uuid: "cluster-uuid-0001",
      memory_capacity_in_bytes: 274_877_906_944,
      usage_stats: {
        hypervisor_cpu_usage_ppm: 250_000,
        hypervisor_memory_usage_ppm: 600_000,
      },
      num_vms: 3,
      serial: "SN-AHV-01",
    },
  ],
};

const SAMPLE_PE_CONTAINERS = {
  entities: [
    {
      storage_container_uuid: "sc-uuid-0001",
      name: "default-container",
      cluster_uuid: "cluster-uuid-0001",
      replication_factor: 2,
      compression_enabled: true,
      usage_stats: {
        "storage.user_capacity_bytes": 10_000_000_000_000,
        "storage.user_usage_bytes": 4_000_000_000_000,
        "storage.user_free_bytes": 6_000_000_000_000,
      },
    },
  ],
};

async function createServer(options: {
  settings?: Record<string, unknown>;
  permissions?: string[];
  fetch?: FakeContextOptions["fetch"];
}) {
  let router: Router | null = null;
  lastPutBody = null;

  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    sandbox: true,
    capabilities: manifest.capabilities,
    settings: options.settings ?? {
      prismUrl: "https://prism.example.test:9440",
      peUrl: "https://pe.example.test:9440",
      username: "admin",
      password: "secret-password",
      allowInsecureTls: false,
      defaultFolder: "Nutanix VMs",
    },
    permissions: options.permissions ?? ["nutanix.view", "nutanix.manage"],
    hosts: [
      {
        id: 101,
        userId: "user-1",
        name: "web-01-edge",
        ip: "10.0.1.50",
        port: 22,
        username: "root",
        folder: "Core",
        tags: "",
        authType: "none",
      },
      {
        id: 102,
        userId: "user-1",
        name: "db-01",
        ip: "192.168.50.10",
        port: 22,
        username: "postgres",
        folder: "Databases",
        tags: "",
        authType: "none",
      },
    ],
    fetch:
      options.fetch ??
      (async (url, init) => {
        if (url.endsWith("/api/nutanix/v3/clusters/list")) {
          return new Response(JSON.stringify(SAMPLE_CLUSTERS), { status: 200 });
        }
        if (url.endsWith("/api/nutanix/v3/hosts/list")) {
          return new Response(JSON.stringify(SAMPLE_HOSTS), { status: 200 });
        }
        if (url.endsWith("/api/nutanix/v3/vms/list")) {
          return new Response(JSON.stringify(SAMPLE_VMS), { status: 200 });
        }
        if (url.endsWith("/PrismGateway/services/rest/v2.0/hosts/")) {
          return new Response(JSON.stringify(SAMPLE_PE_HOSTS), { status: 200 });
        }
        if (
          url.endsWith("/PrismGateway/services/rest/v2.0/storage_containers/")
        ) {
          return new Response(JSON.stringify(SAMPLE_PE_CONTAINERS), {
            status: 200,
          });
        }
        if (
          url.endsWith("/api/nutanix/v3/vms/vm-uuid-0001") &&
          (!init?.method || init.method === "GET")
        ) {
          return new Response(JSON.stringify(SAMPLE_VMS.entities[0]), {
            status: 200,
          });
        }
        if (
          url.endsWith("/api/nutanix/v3/vms/vm-uuid-0001") &&
          init?.method === "PUT"
        ) {
          lastPutBody = JSON.parse(String(init.body ?? "{}"));
          return new Response(JSON.stringify({ status: "OK" }), {
            status: 202,
          });
        }
        return new Response("Not Found", { status: 404 });
      }),
    router: () => (router = express.Router()),
  });

  await activate(mock.ctx);

  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => {
    mock.setActor("user-1");
    next();
  });
  app.use((req, res, next) => router!(req, res, next));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return { mock, server, port };
}

async function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

let activeHarness: { server: http.Server; mock: MockPluginContext } | null =
  null;

afterEach(async () => {
  if (activeHarness) {
    await new Promise<void>((resolve) =>
      activeHarness!.server.close(() => resolve()),
    );
    activeHarness = null;
  }
  await deactivate();
});

describe("nutanix backend routes", () => {
  it("returns unconfigured payload when Prism settings are empty", async () => {
    const harness = await createServer({
      settings: { prismUrl: "", username: "", password: "" },
    });
    activeHarness = harness;

    const res = await request(harness.port, "GET", "/status");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.vms).toEqual([]);
    expect(harness.mock.fetches).toEqual([]);
  });

  it("collects inventory and links multi-NIC and name-matched VMs", async () => {
    const harness = await createServer({});
    activeHarness = harness;

    const res = await request(harness.port, "GET", "/status");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.clusters).toHaveLength(1);
    expect(res.body.clusters[0].name).toBe("prod-ahv-01");
    expect(res.body.hosts[0]).toMatchObject({
      name: "ahv-node-01",
      cpuUsagePct: 25,
      memoryUsagePct: 60,
    });
    expect(res.body.containers[0]).toMatchObject({
      name: "default-container",
      usagePct: 40,
    });
    expect(res.body.summary).toMatchObject({
      clusterCount: 1,
      hostCount: 1,
      containerCount: 1,
      vmCount: 3,
      runningVms: 2,
      stoppedVms: 1,
    });

    const vms = res.body.vms as Array<Record<string, unknown>>;
    expect(vms.find((v) => v.name === "web-01")?.linkedHostId).toBe(101);
    expect(vms.find((v) => v.name === "DB-01")?.linkedHostId).toBe(102);
    expect(vms.find((v) => v.name === "worker-new")?.linkedHostId).toBeNull();

    // Ensure private hosts allowance was supplied to ctx.fetch
    expect(harness.mock.fetches[0].init?.allowPrivateHosts).toEqual([
      "prism.example.test",
    ]);
  });

  it("enforces view and manage permissions on routes", async () => {
    const noView = await createServer({ permissions: [] });
    activeHarness = noView;
    const statusDenied = await request(noView.port, "GET", "/status");
    expect(statusDenied.status).toBe(403);
    await new Promise<void>((resolve) => noView.server.close(() => resolve()));
    activeHarness = null;

    const viewOnly = await createServer({ permissions: ["nutanix.view"] });
    activeHarness = viewOnly;
    const powerDenied = await request(
      viewOnly.port,
      "POST",
      "/vms/vm-uuid-0001/power",
      { state: "OFF" },
    );
    expect(powerDenied.status).toBe(403);

    const importDenied = await request(viewOnly.port, "POST", "/import-vms", {
      uuids: [],
    });
    expect(importDenied.status).toBe(403);
  });

  it("validates and executes VM power control with audit trail", async () => {
    const harness = await createServer({});
    activeHarness = harness;

    const badState = await request(
      harness.port,
      "POST",
      "/vms/vm-uuid-0001/power",
      { state: "REBOOT" },
    );
    expect(badState.status).toBe(400);

    const ok = await request(harness.port, "POST", "/vms/vm-uuid-0001/power", {
      state: "OFF",
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      success: true,
      uuid: "vm-uuid-0001",
      name: "web-01",
      state: "OFF",
    });
    expect(lastPutBody).toMatchObject({
      spec: { resources: { power_state: "OFF" } },
    });
    expect(harness.mock.audits).toContainEqual(
      expect.objectContaining({
        action: "nutanix.vm.power",
        resourceId: "vm-uuid-0001",
        success: true,
      }),
    );
  });

  it("imports unlinked VMs and skips linked ones", async () => {
    const harness = await createServer({});
    activeHarness = harness;

    const res = await request(harness.port, "POST", "/import-vms", {});
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.skipped).toBe(2);
    expect(res.body.hosts).toEqual([
      expect.objectContaining({ name: "worker-new", ip: "10.0.1.70" }),
    ]);
  });

  it("registers and executes operations actions", async () => {
    const harness = await createServer({});
    activeHarness = harness;

    const summaryHandler =
      harness.mock.operationHandlers.get("nutanix.summary");
    expect(summaryHandler).toBeDefined();
    const summaryRes = await summaryHandler!.run({}, {
      signal: new AbortController().signal,
      dryRun: false,
      log: () => {},
    } as never);
    expect(summaryRes.summary).toContain(
      "1 clusters, 1 AHV hosts, 2/3 VMs running",
    );

    const powerHandler = harness.mock.operationHandlers.get("nutanix.power-vm");
    expect(
      powerHandler?.describe?.(
        { uuid: "vm-uuid-0001", state: "OFF" },
        {} as never,
      ),
    ).toContain("vm-uuid-0001");
  });
});
