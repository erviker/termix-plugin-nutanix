import { useCallback, useEffect, useMemo, useState } from "react";
import {
  usePermission,
  useToast,
  useTranslation,
  type TabProps,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  LoadingState,
  NoticePanel,
  StatTile,
  StatusBadge,
} from "@termix-ssh/plugin-sdk/ui";
import type { NutanixStatusResponse, NutanixVm } from "../backend/types.js";

const TAB_ID = "nutanix";
type SubView = "vms" | "hosts" | "containers" | "clusters";

function ServerIcon(props: { className?: string }) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <line x1="6" x2="6.01" y1="6" y2="6" />
      <line x1="6" x2="6.01" y1="18" y2="18" />
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 100 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

function formatMemoryMb(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return "0 MiB";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GiB`;
  return `${mb} MiB`;
}

function createTab(app: TermixApp) {
  return function NutanixTab({ isVisible }: TabProps) {
    const { t } = useTranslation();
    const toast = useToast();
    const canManage = usePermission("manage");

    const [status, setStatus] = useState<NutanixStatusResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [importing, setImporting] = useState(false);
    const [powerBusyUuid, setPowerBusyUuid] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeView, setActiveView] = useState<SubView>("vms");
    const [search, setSearch] = useState("");
    const [selectedCluster, setSelectedCluster] = useState<string>("all");

    const load = useCallback(
      async (force = false) => {
        if (force) setRefreshing(true);
        else setLoading((prev) => (status ? prev : true));

        try {
          const query = force ? "?refresh=1" : "";
          const { data } = await app.api.get<NutanixStatusResponse>(
            `/status${query}`,
          );
          setStatus(data);
          setError(data.error ?? null);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : t("tab.messages.loadError");
          setError(message);
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      },
      [t, status],
    );

    useEffect(() => {
      if (isVisible) void load(false);
    }, [isVisible]);

    useEffect(() => {
      return app.onSettingsChanged((change) => {
        if (change.scope === "admin" && isVisible) {
          void load(true);
        }
      });
    }, [isVisible]);

    const clusterNames = useMemo(() => {
      if (!status) return [];
      return Array.from(
        new Set(
          status.vms
            .map((vm) => vm.clusterName)
            .filter((name) => Boolean(name)),
        ),
      ).sort();
    }, [status]);

    const filteredVms = useMemo(() => {
      if (!status) return [];
      const q = search.trim().toLowerCase();
      return status.vms.filter((vm) => {
        if (selectedCluster !== "all" && vm.clusterName !== selectedCluster) {
          return false;
        }
        if (!q) return true;
        return (
          vm.name.toLowerCase().includes(q) ||
          vm.clusterName.toLowerCase().includes(q) ||
          vm.hostName.toLowerCase().includes(q) ||
          vm.ipList.some((ip) => ip.toLowerCase().includes(q))
        );
      });
    }, [status, search, selectedCluster]);

    const unlinkedImportableCount = useMemo(() => {
      return filteredVms.filter((vm) => !vm.linkedHostId && vm.primaryIp)
        .length;
    }, [filteredVms]);

    const handlePower = async (vm: NutanixVm, nextState: "ON" | "OFF") => {
      setPowerBusyUuid(vm.uuid);
      try {
        await app.api.post(`/vms/${encodeURIComponent(vm.uuid)}/power`, {
          state: nextState,
        });
        toast.success(
          t("tab.messages.powerSuccess", { name: vm.name, state: nextState }),
        );
        await load(true);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : t("tab.messages.powerError");
        toast.error(msg);
      } finally {
        setPowerBusyUuid(null);
      }
    };

    const handleImport = async (uuids?: string[]) => {
      setImporting(true);
      try {
        const { data } = await app.api.post<{
          created: number;
          skipped: number;
        }>("/import-vms", uuids ? { uuids } : {});
        toast.success(
          t("tab.messages.importSuccess", {
            created: data.created,
            skipped: data.skipped,
          }),
        );
        await load(true);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : t("tab.messages.importError");
        toast.error(msg);
      } finally {
        setImporting(false);
      }
    };

    if (loading && !status) {
      return (
        <div className="p-6">
          <LoadingState />
        </div>
      );
    }

    if (status && !status.configured) {
      return (
        <div className="p-6">
          <NoticePanel
            title={t("tab.notConfiguredTitle")}
            tone="warning"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void load(true)}
              >
                {t("tab.refresh")}
              </Button>
            }
          >
            {t("tab.notConfiguredBody")}
          </NoticePanel>
        </div>
      );
    }

    const summary = status?.summary;
    const memoryPct =
      summary && summary.totalMemoryBytes > 0
        ? Math.round((summary.usedMemoryBytes / summary.totalMemoryBytes) * 100)
        : null;
    const storagePct =
      summary && summary.totalStorageBytes > 0
        ? Math.round(
            (summary.usedStorageBytes / summary.totalStorageBytes) * 100,
          )
        : null;

    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {t("tab.title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("tab.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManage && unlinkedImportableCount > 0 && (
              <Button
                size="sm"
                disabled={importing}
                onClick={() => void handleImport()}
              >
                {importing ? t("tab.importing") : t("tab.importAll")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={() => void load(true)}
            >
              {t("tab.refresh")}
            </Button>
          </div>
        </div>

        {error && (
          <NoticePanel title={t("tab.messages.loadError")} tone="destructive">
            {error}
          </NoticePanel>
        )}

        {summary && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile
              label={t("tab.stats.clusters")}
              value={summary.clusterCount}
            />
            <StatTile label={t("tab.stats.hosts")} value={summary.hostCount} />
            <StatTile
              label={t("tab.stats.vms")}
              value={summary.vmCount}
              hint={t("tab.stats.vmsRunning", { count: summary.runningVms })}
            />
            <StatTile
              label={t("tab.stats.memory")}
              value={
                summary.totalMemoryBytes > 0
                  ? formatBytes(summary.usedMemoryBytes)
                  : "-"
              }
              unit={
                summary.totalMemoryBytes > 0
                  ? `/ ${formatBytes(summary.totalMemoryBytes)}`
                  : undefined
              }
              percent={memoryPct}
            />
            <StatTile
              label={t("tab.stats.storage")}
              value={
                summary.totalStorageBytes > 0
                  ? formatBytes(summary.usedStorageBytes)
                  : "-"
              }
              unit={
                summary.totalStorageBytes > 0
                  ? `/ ${formatBytes(summary.totalStorageBytes)}`
                  : undefined
              }
              percent={storagePct}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
          <div className="flex flex-wrap gap-1.5">
            {(["vms", "hosts", "containers", "clusters"] as const).map(
              (view) => (
                <Button
                  key={view}
                  size="sm"
                  variant={activeView === view ? "default" : "ghost"}
                  onClick={() => setActiveView(view)}
                >
                  {t(`tab.tabs.${view}`)}
                </Button>
              ),
            )}
          </div>
          {activeView === "vms" && (
            <div className="flex flex-wrap items-center gap-2">
              {clusterNames.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant={selectedCluster === "all" ? "secondary" : "ghost"}
                    onClick={() => setSelectedCluster("all")}
                  >
                    {t("tab.allClusters")}
                  </Button>
                  {clusterNames.map((cluster) => (
                    <Button
                      key={cluster}
                      size="sm"
                      variant={
                        selectedCluster === cluster ? "secondary" : "ghost"
                      }
                      onClick={() => setSelectedCluster(cluster)}
                    >
                      {cluster}
                    </Button>
                  ))}
                </div>
              )}
              <Input
                className="w-60"
                value={search}
                placeholder={t("tab.searchPlaceholder")}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          )}
        </div>

        {activeView === "vms" && (
          <Card>
            <CardContent className="p-0">
              {filteredVms.length === 0 ? (
                <div className="p-6">
                  <EmptyState title={t("tab.vm.empty")} />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2.5 font-medium">
                          {t("tab.vm.name")}
                        </th>
                        <th className="px-4 py-2.5 font-medium">
                          {t("tab.vm.power")}
                        </th>
                        <th className="px-4 py-2.5 font-medium">
                          {t("tab.vm.cluster")}
                        </th>
                        <th className="px-4 py-2.5 font-medium">
                          {t("tab.vm.vcpus")}
                        </th>
                        <th className="px-4 py-2.5 font-medium">
                          {t("tab.vm.memory")}
                        </th>
                        <th className="px-4 py-2.5 font-medium">
                          {t("tab.vm.ip")}
                        </th>
                        <th className="px-4 py-2.5 font-medium">
                          {t("tab.vm.linkedHost")}
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          {t("tab.vm.actions")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredVms.map((vm) => {
                        const isOn = vm.powerState === "ON";
                        const busy = powerBusyUuid === vm.uuid;
                        const linkedHost = vm.linkedHostId
                          ? app.getHost(vm.linkedHostId)
                          : undefined;
                        return (
                          <tr
                            key={vm.uuid}
                            className="border-b border-border/60 last:border-0"
                          >
                            <td className="px-4 py-2.5 font-medium">
                              <div>{vm.name}</div>
                              {vm.hostName && (
                                <div className="text-xs text-muted-foreground">
                                  {vm.hostName}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusBadge
                                tone={isOn ? "ok" : "idle"}
                                state={vm.powerState}
                              />
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {vm.clusterName || "-"}
                            </td>
                            <td className="px-4 py-2.5">{vm.numVcpus}</td>
                            <td className="px-4 py-2.5">
                              {formatMemoryMb(vm.memoryMb)}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs">
                              {vm.ipList.length > 0
                                ? vm.ipList.join(", ")
                                : "-"}
                            </td>
                            <td className="px-4 py-2.5">
                              {vm.linkedHostId ? (
                                <Badge variant="secondary">
                                  {vm.linkedHostName ?? t("tab.vm.imported")}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {t("tab.vm.unlinked")}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                {linkedHost && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      app.tabs.connectHost(linkedHost)
                                    }
                                  >
                                    {t("tab.vm.connect")}
                                  </Button>
                                )}
                                {canManage &&
                                  !vm.linkedHostId &&
                                  vm.primaryIp && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={importing}
                                      onClick={() =>
                                        void handleImport([vm.uuid])
                                      }
                                    >
                                      {t("tab.vm.importOne")}
                                    </Button>
                                  )}
                                {canManage && (
                                  <Button
                                    size="sm"
                                    variant={isOn ? "destructive" : "default"}
                                    disabled={busy}
                                    onClick={() =>
                                      void handlePower(vm, isOn ? "OFF" : "ON")
                                    }
                                  >
                                    {isOn
                                      ? t("tab.vm.powerOff")
                                      : t("tab.vm.powerOn")}
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeView === "hosts" && (
          <div className="grid gap-3 md:grid-cols-2">
            {!status || status.hosts.length === 0 ? (
              <EmptyState title={t("tab.host.empty")} />
            ) : (
              status.hosts.map((host) => (
                <Card key={host.uuid}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">{host.name}</CardTitle>
                      {host.clusterName && (
                        <Badge variant="outline">{host.clusterName}</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">
                        {t("tab.host.hypervisor")}:{" "}
                      </span>
                      {host.hypervisorVersion}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t("tab.host.controllerIp")}:{" "}
                      </span>
                      <span className="font-mono text-xs">
                        {host.controllerIp || "-"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t("tab.host.cpu")}:{" "}
                      </span>
                      {host.numCpuCores} cores
                      {host.cpuUsagePct !== null
                        ? ` (${host.cpuUsagePct}%)`
                        : ""}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t("tab.host.memory")}:{" "}
                      </span>
                      {formatBytes(host.memoryBytes)}
                      {host.memoryUsagePct !== null
                        ? ` (${host.memoryUsagePct}%)`
                        : ""}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t("tab.host.vms")}:{" "}
                      </span>
                      {host.numVms}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t("tab.host.serial")}:{" "}
                      </span>
                      <span className="font-mono text-xs">
                        {host.serial || "-"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}

        {activeView === "containers" && (
          <div className="grid gap-3 md:grid-cols-2">
            {!status || status.containers.length === 0 ? (
              <EmptyState title={t("tab.container.empty")} />
            ) : (
              status.containers.map((container) => (
                <Card key={container.uuid}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">
                        {container.name}
                      </CardTitle>
                      <Badge variant="secondary">
                        RF {container.replicationFactor}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">
                        {t("tab.container.used")}:{" "}
                      </span>
                      {formatBytes(container.usedBytes)}
                      {container.usagePct !== null
                        ? ` (${container.usagePct}%)`
                        : ""}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t("tab.container.free")}:{" "}
                      </span>
                      {formatBytes(container.freeBytes)}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t("tab.container.capacity")}:{" "}
                      </span>
                      {formatBytes(container.capacityBytes)}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t("tab.container.compression")}:{" "}
                      </span>
                      {container.compressionEnabled ? "ON" : "OFF"}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}

        {activeView === "clusters" && (
          <div className="grid gap-3 md:grid-cols-2">
            {!status || status.clusters.length === 0 ? (
              <EmptyState title={t("tab.cluster.empty")} />
            ) : (
              status.clusters.map((cluster) => (
                <Card key={cluster.uuid}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">
                        {cluster.name}
                      </CardTitle>
                      <Badge variant="outline">{cluster.aosVersion}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">
                        {t("tab.cluster.externalIp")}:{" "}
                      </span>
                      <span className="font-mono text-xs">
                        {cluster.externalIp || "-"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t("tab.cluster.nodes")}:{" "}
                      </span>
                      {cluster.nodeCount}
                    </div>
                    <div className="col-span-2 flex flex-wrap gap-1 pt-1">
                      {cluster.services.map((service) => (
                        <Badge key={service} variant="secondary">
                          {service}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    );
  };
}

export function activate(app: TermixApp): void {
  app.registerRailItem({
    id: TAB_ID,
    icon: ServerIcon,
    titleKey: "tab.title",
    kind: "tab",
    permission: "view",
  });
  app.registerTab(TAB_ID, createTab(app), {
    icon: ServerIcon,
    titleKey: "tab.title",
    singleton: true,
    hostless: true,
  });
}
