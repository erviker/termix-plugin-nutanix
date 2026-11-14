import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { collectInventory, setVmPowerState } from "./prism.js";

export function registerOperations(ctx: PluginContext): void {
  if (typeof ctx.operations?.register !== "function") return;

  ctx.operations.register("nutanix.summary", {
    run: async (_input, opCtx) => {
      if (opCtx.signal.aborted) {
        throw new Error("Operation aborted");
      }
      const status = await collectInventory(ctx, { signal: opCtx.signal });
      if (!status.configured) {
        return {
          summary: "Nutanix Prism Central is not configured",
          data: status.summary,
        };
      }
      const s = status.summary;
      return {
        summary: `${s.clusterCount} clusters, ${s.hostCount} AHV hosts, ${s.runningVms}/${s.vmCount} VMs running`,
        data: s,
      };
    },
  });

  ctx.operations.register("nutanix.list-vms", {
    run: async (input, opCtx) => {
      if (opCtx.signal.aborted) {
        throw new Error("Operation aborted");
      }
      const status = await collectInventory(ctx, { signal: opCtx.signal });
      const clusterFilter =
        typeof input.cluster === "string"
          ? input.cluster.trim().toLowerCase()
          : "";
      const vms = clusterFilter
        ? status.vms.filter(
            (vm) => vm.clusterName.toLowerCase() === clusterFilter,
          )
        : status.vms;

      return {
        summary: `${vms.length} VMs found`,
        data: { vms },
      };
    },
  });

  ctx.operations.register("nutanix.power-vm", {
    describe: (input) =>
      `Would set Nutanix VM ${String(input.uuid)} power state to ${String(input.state)}`,
    run: async (input, opCtx) => {
      if (opCtx.signal.aborted) {
        throw new Error("Operation aborted");
      }
      const uuid = String(input.uuid ?? "").trim();
      const state = String(input.state ?? "")
        .trim()
        .toUpperCase();
      if (state !== "ON" && state !== "OFF") {
        throw new Error("state must be ON or OFF");
      }
      const result = await setVmPowerState(ctx, uuid, state, opCtx.signal);
      return {
        summary: `Set VM ${result.name} power state to ${result.state}`,
        changed: true,
        data: result,
      };
    },
  });
}
