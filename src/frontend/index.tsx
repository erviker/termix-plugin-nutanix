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
import type {
  NutanixStatusResponse,
  NutanixVm,
  NutanixVmTelemetry,
} from "../backend/types.js";

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

function usageTone(pct: number | null): "default" | "ok" | "warn" | "bad" {
  if (pct === null) return "default";
  if (pct >= 85) return "bad";
  if (pct >= 70) return "warn";
  return "ok";
}

function toneBarColor(pct: number | null): string {
  const tone = usageTone(pct);
  if (tone === "bad") return "#f43f5e";
  if (tone === "warn") return "#f59e0b";
  if (tone === "ok") return "#10b981";
  return "#38bdf8";
}

function MetricProgress({
  primary,
  secondary,
  percent,
}: {
  primary: string;
  secondary?: string;
  percent: number | null;
}) {
  const clamped =
    percent === null ? 0 : Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div style={{ minWidth: "96px" }}>
      <div className="flex items-baseline justify-between gap-2 tabular-nums">
        <span className="font-medium">{primary}</span>
        {percent !== null && (
          <span className="text-xs text-muted-foreground">{percent}%</span>
        )}
      </div>
      {percent !== null && (
        <div
          className="mt-1 w-full overflow-hidden rounded-full"
          style={{
            height: "6px",
            backgroundColor: "rgba(128, 128, 128, 0.24)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${clamped}%`,
              minWidth: clamped > 0 ? "3px" : undefined,
              borderRadius: "9999px",
              backgroundColor: toneBarColor(percent),
            }}
          />
        </div>
      )}
      {secondary && (
        <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {secondary}
        </div>
      )}
    </div>
  );
}

function formatVmDiskSummary(telemetry?: NutanixVmTelemetry): {
  primary: string;
  secondary?: string;
  percent: number | null;
} {
  if (
    !telemetry ||
    (telemetry.diskCapacityBytes <= 0 && telemetry.diskUsedBytes === null)
  ) {
    return { primary: "-", percent: null };
  }
  const primary =
    telemetry.diskUsedBytes !== null
      ? formatBytes(telemetry.diskUsedBytes)
      : formatBytes(telemetry.diskCapacityBytes);
  const secondary =
    telemetry.diskCapacityBytes > 0 && telemetry.diskUsedBytes !== null
      ? `/ ${formatBytes(telemetry.diskCapacityBytes)}`
      : undefined;
  return { primary, secondary, percent: telemetry.diskUsagePct };
}

function formatVmIoSummary(telemetry?: NutanixVmTelemetry): string {
  if (!telemetry) return "-";
  const parts: string[] = [];
  if (telemetry.iops !== null) parts.push(`${telemetry.iops} IOPS`);
  if (telemetry.ioBandwidthKbps !== null && telemetry.ioBandwidthKbps > 0) {
    parts.push(`${telemetry.ioBandwidthKbps} KB/s`);
  }
  return parts.length > 0 ? parts.join(" • ") : "-";
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
    const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>(
      {},
    );

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
        ? Math.round(
            (summary.usedMemoryBytes / summary.totalMemoryBytes) * 1000,
          ) / 10
        : null;
    const storagePct =
      summary && summary.totalStorageBytes > 0
        ? Math.round(
            (summary.usedStorageBytes / summary.totalStorageBytes) * 1000,
          ) / 10
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
              hint={`${summary.hostCount} ${t("tab.stats.hosts")}`}
            />
            <StatTile
              label={t("tab.stats.cpu")}
              value={
                summary.cpuUsagePct !== null ? `${summary.cpuUsagePct}%` : "-"
              }
              percent={summary.cpuUsagePct}
              tone={usageTone(summary.cpuUsagePct)}
              hint={t("tab.stats.cpuCores", {
                cores: summary.totalCpuCores,
                hosts: summary.hostCount,
              })}
            />
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
              tone={usageTone(memoryPct)}
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
              tone={usageTone(storagePct)}
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
                          {t("tab.vm.disk")}
                        </th>
                        <th className="px-4 py-2.5 font-medium">
                          {t("tab.vm.io")}
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
                            <td className="px-4 py-2.5">
                              <MetricProgress
                                primary={`${vm.numVcpus} vCPU`}
                                percent={vm.telemetry?.cpuUsagePct ?? null}
                              />
                            </td>
                            <td className="px-4 py-2.5">
                              <MetricProgress
                                primary={
                                  vm.telemetry?.memoryUsedMb !== null &&
                                  vm.telemetry?.memoryUsedMb !== undefined
                                    ? formatMemoryMb(vm.telemetry.memoryUsedMb)
                                    : formatMemoryMb(vm.memoryMb)
                                }
                                secondary={
                                  vm.telemetry?.memoryUsedMb !== null &&
                                  vm.telemetry?.memoryUsedMb !== undefined
                                    ? `/ ${formatMemoryMb(vm.memoryMb)}`
                                    : undefined
                                }
                                percent={vm.telemetry?.memoryUsagePct ?? null}
                              />
                            </td>
                            <td className="px-4 py-2.5">
                              {(() => {
                                const disk = formatVmDiskSummary(vm.telemetry);
                                return (
                                  <MetricProgress
                                    primary={disk.primary}
                                    secondary={disk.secondary}
                                    percent={disk.percent}
                                  />
                                );
                              })()}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">
                              {formatVmIoSummary(vm.telemetry)}
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
          <div className="flex flex-col gap-4">
            {!status || status.hosts.length === 0 ? (
              <EmptyState title={t("tab.host.empty")} />
            ) : (
              status.hosts.map((host) => {
                const nodeKey = host.uuid || host.name;
                const isExpanded =
                  expandedNodes[nodeKey] ?? status.hosts.length === 1;
                const vmRunningPct =
                  host.vmOverview.total > 0
                    ? Math.round(
                        (host.vmOverview.running / host.vmOverview.total) * 100,
                      )
                    : null;

                return (
                  <Card key={nodeKey}>
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="text-base">
                              {host.name}
                            </CardTitle>
                            <StatusBadge
                              tone={host.state === "NORMAL" ? "ok" : "warn"}
                              state={host.state}
                            />
                            {host.clusterName && (
                              <Badge variant="outline">
                                {host.clusterName}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {host.hypervisorVersion} •{" "}
                            {t("tab.host.hypervisorIp")}:{" "}
                            <span className="font-mono">
                              {host.hypervisorAddress || "-"}
                            </span>{" "}
                            • {t("tab.host.controllerIp")}:{" "}
                            <span className="font-mono">
                              {host.controllerIp || "-"}
                            </span>{" "}
                            • {t("tab.host.serial")}:{" "}
                            <span className="font-mono">
                              {host.serial || "-"}
                            </span>
                          </p>
                        </div>
                        {host.vmOverview.vms.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setExpandedNodes((prev) => ({
                                ...prev,
                                [nodeKey]: !isExpanded,
                              }))
                            }
                          >
                            {isExpanded
                              ? t("tab.host.hideVms", {
                                  count: host.vmOverview.vms.length,
                                })
                              : t("tab.host.showVms", {
                                  count: host.vmOverview.vms.length,
                                })}
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <StatTile
                          label={t("tab.host.cpu")}
                          value={
                            host.cpuUsagePct !== null
                              ? `${host.cpuUsagePct}%`
                              : "-"
                          }
                          percent={host.cpuUsagePct}
                          tone={usageTone(host.cpuUsagePct)}
                          hint={t("tab.host.cpuCoresHint", {
                            cores: host.numCpuCores,
                            sockets: host.numCpuSockets,
                          })}
                        />
                        <StatTile
                          label={t("tab.host.memory")}
                          value={
                            host.memoryUsedBytes > 0
                              ? formatBytes(host.memoryUsedBytes)
                              : formatBytes(host.memoryBytes)
                          }
                          unit={
                            host.memoryBytes > 0
                              ? `/ ${formatBytes(host.memoryBytes)}`
                              : undefined
                          }
                          percent={host.memoryUsagePct}
                          tone={usageTone(host.memoryUsagePct)}
                          hint={
                            host.memoryUsagePct !== null
                              ? `${host.memoryUsagePct}%`
                              : undefined
                          }
                        />
                        <StatTile
                          label={t("tab.host.disk")}
                          value={
                            host.diskCapacityBytes > 0
                              ? formatBytes(host.diskUsedBytes)
                              : "-"
                          }
                          unit={
                            host.diskCapacityBytes > 0
                              ? `/ ${formatBytes(host.diskCapacityBytes)}`
                              : undefined
                          }
                          percent={host.diskUsagePct}
                          tone={usageTone(host.diskUsagePct)}
                          hint={
                            host.diskCapacityBytes > 0
                              ? t("tab.host.diskHint", {
                                  free: formatBytes(host.diskFreeBytes),
                                  iops: host.iops,
                                })
                              : undefined
                          }
                        />
                        <StatTile
                          label={t("tab.host.vmsOverview")}
                          value={`${host.vmOverview.running} / ${host.vmOverview.total}`}
                          percent={vmRunningPct}
                          tone="ok"
                          hint={t("tab.host.vmsHint", {
                            vcpus: host.vmOverview.allocatedVcpus,
                            memory: formatMemoryMb(
                              host.vmOverview.allocatedMemoryMb,
                            ),
                            linked: host.vmOverview.linkedToTermix,
                          })}
                        />
                      </div>

                      {isExpanded && host.vmOverview.vms.length > 0 && (
                        <div className="overflow-x-auto rounded-md border border-border">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border text-left text-muted-foreground">
                                <th className="px-3 py-2 font-medium">
                                  {t("tab.vm.name")}
                                </th>
                                <th className="px-3 py-2 font-medium">
                                  {t("tab.vm.power")}
                                </th>
                                <th className="px-3 py-2 font-medium">
                                  {t("tab.vm.vcpus")}
                                </th>
                                <th className="px-3 py-2 font-medium">
                                  {t("tab.vm.memory")}
                                </th>
                                <th className="px-3 py-2 font-medium">
                                  {t("tab.vm.disk")}
                                </th>
                                <th className="px-3 py-2 font-medium">
                                  {t("tab.vm.io")}
                                </th>
                                <th className="px-3 py-2 font-medium">
                                  {t("tab.vm.ip")}
                                </th>
                                <th className="px-3 py-2 text-right font-medium">
                                  {t("tab.vm.actions")}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {host.vmOverview.vms.map((nodeVm) => {
                                const linkedHost = nodeVm.linkedHostId
                                  ? app.getHost(nodeVm.linkedHostId)
                                  : undefined;
                                return (
                                  <tr
                                    key={nodeVm.uuid}
                                    className="border-b border-border/50 last:border-0"
                                  >
                                    <td className="px-3 py-1.5 font-medium">
                                      {nodeVm.name}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      <StatusBadge
                                        tone={
                                          nodeVm.powerState === "ON"
                                            ? "ok"
                                            : "idle"
                                        }
                                        state={nodeVm.powerState}
                                      />
                                    </td>
                                    <td className="px-3 py-1.5 tabular-nums">
                                      {nodeVm.numVcpus} vCPU
                                      {nodeVm.telemetry?.cpuUsagePct !== null &&
                                      nodeVm.telemetry?.cpuUsagePct !==
                                        undefined
                                        ? ` (${nodeVm.telemetry.cpuUsagePct}%)`
                                        : ""}
                                    </td>
                                    <td className="px-3 py-1.5 tabular-nums">
                                      {formatMemoryMb(nodeVm.memoryMb)}
                                      {nodeVm.telemetry?.memoryUsagePct !==
                                        null &&
                                      nodeVm.telemetry?.memoryUsagePct !==
                                        undefined
                                        ? ` (${nodeVm.telemetry.memoryUsagePct}%)`
                                        : ""}
                                    </td>
                                    <td className="px-3 py-1.5 tabular-nums">
                                      {(() => {
                                        const d = formatVmDiskSummary(
                                          nodeVm.telemetry,
                                        );
                                        return d.secondary
                                          ? `${d.primary} ${d.secondary}`
                                          : d.primary;
                                      })()}
                                    </td>
                                    <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                                      {formatVmIoSummary(nodeVm.telemetry)}
                                    </td>
                                    <td className="px-3 py-1.5 font-mono">
                                      {nodeVm.primaryIp || "-"}
                                    </td>
                                    <td className="px-3 py-1.5 text-right">
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
                );
              })
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
