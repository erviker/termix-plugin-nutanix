import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import {
  clearInventoryCache,
  collectInventory,
  emptyStatus,
  isConfigured,
  readConfig,
  setVmPowerState,
  VALID_VM_UUID_RE,
} from "./prism.js";

export function registerRoutes(router: Router, ctx: PluginContext): void {
  /**
   * @openapi
   * /plugin-api/nutanix/status:
   *   get:
   *     summary: Get Nutanix cluster, AHV host, storage container, and VM inventory
   *     tags:
   *       - Nutanix
   *     responses:
   *       200:
   *         description: Inventory snapshot or unconfigured status
   *       502:
   *         description: Prism API request failed
   */
  router.get(
    "/status",
    ctx.rbac.require("view") as never,
    async (req: Request, res: Response) => {
      const config = await readConfig(ctx);
      if (!isConfigured(config)) {
        return res.json(emptyStatus(config));
      }
      const force = req.query.refresh === "1" || req.query.refresh === "true";
      try {
        const data = await collectInventory(ctx, { force });
        res.json(data);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to reach Nutanix Prism";
        res.status(502).json({
          ...emptyStatus(config),
          configured: true,
          error: message,
        });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/nutanix/vms:
   *   get:
   *     summary: List discovered Nutanix virtual machines matched against Termix hosts
   *     tags:
   *       - Nutanix
   *     responses:
   *       200:
   *         description: VM list and configuration flag
   *       502:
   *         description: Prism API request failed
   */
  router.get(
    "/vms",
    ctx.rbac.require("view") as never,
    async (req: Request, res: Response) => {
      const config = await readConfig(ctx);
      if (!isConfigured(config)) {
        return res.json({ configured: false, vms: [] });
      }
      const force = req.query.refresh === "1" || req.query.refresh === "true";
      try {
        const data = await collectInventory(ctx, { force });
        res.json({ configured: true, vms: data.vms });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to list Nutanix VMs";
        res.status(502).json({ configured: true, vms: [], error: message });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/nutanix/vms/{uuid}/power:
   *   post:
   *     summary: Power a Nutanix VM ON or OFF
   *     tags:
   *       - Nutanix
   *     parameters:
   *       - in: path
   *         name: uuid
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - state
   *             properties:
   *               state:
   *                 type: string
   *                 enum: [ON, OFF]
   *     responses:
   *       200:
   *         description: VM power state updated
   *       400:
   *         description: Invalid UUID or power state
   *       502:
   *         description: Prism API request failed
   */
  router.post(
    "/vms/:uuid/power",
    ctx.rbac.require("manage") as never,
    async (req: Request, res: Response) => {
      const uuid = String(req.params.uuid ?? "").trim();
      const state = String(req.body?.state ?? "")
        .trim()
        .toUpperCase();

      if (!VALID_VM_UUID_RE.test(uuid)) {
        return res.status(400).json({ error: "Invalid VM UUID" });
      }
      if (state !== "ON" && state !== "OFF") {
        return res.status(400).json({ error: "state must be ON or OFF" });
      }

      try {
        const result = await setVmPowerState(ctx, uuid, state, undefined, req);
        res.json({ success: true, ...result });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to change VM power state";
        res.status(502).json({ error: message });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/nutanix/import-vms:
   *   post:
   *     summary: Import unlinked Nutanix VMs into Termix hosts
   *     tags:
   *       - Nutanix
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               uuids:
   *                 type: array
   *                 items:
   *                   type: string
   *               folder:
   *                 type: string
   *     responses:
   *       200:
   *         description: Import counts and created hosts
   *       502:
   *         description: Prism API request failed
   */
  router.post(
    "/import-vms",
    ctx.rbac.require("manage") as never,
    async (req: Request, res: Response) => {
      const config = await readConfig(ctx);
      if (!isConfigured(config)) {
        return res
          .status(400)
          .json({ error: "Nutanix Prism Central is not configured" });
      }

      const requestedUuids = Array.isArray(req.body?.uuids)
        ? new Set(
            req.body.uuids
              .filter(
                (value: unknown): value is string => typeof value === "string",
              )
              .map((value: string) => value.trim()),
          )
        : null;
      const folder =
        typeof req.body?.folder === "string" && req.body.folder.trim()
          ? req.body.folder.trim()
          : config.defaultFolder;

      try {
        const inventory = await collectInventory(ctx, { force: true });
        const created: Array<{ id: number; name: string; ip: string }> = [];
        let skipped = 0;

        for (const vm of inventory.vms) {
          if (
            requestedUuids &&
            requestedUuids.size > 0 &&
            !requestedUuids.has(vm.uuid)
          ) {
            continue;
          }
          if (vm.linkedHostId || !vm.primaryIp) {
            skipped += 1;
            continue;
          }

          const host = await ctx.hosts.create({
            name: vm.name,
            ip: vm.primaryIp,
            port: 22,
            username: "root",
            authType: "none",
            connectionType: "ssh",
            folder,
            tags: ["nutanix", ...(vm.clusterName ? [vm.clusterName] : [])],
            notes: `Imported from Nutanix (${vm.clusterName || "cluster"}) | UUID: ${vm.uuid}`,
          });
          created.push({
            id: host.id,
            name: host.name ?? vm.name,
            ip: host.ip,
          });
        }

        clearInventoryCache();

        await ctx.audit.record({
          action: "nutanix.vms.import",
          resourceType: "nutanix_vm",
          details: JSON.stringify({
            created: created.length,
            skipped,
            folder,
          }),
          success: true,
          request: req,
        });

        res.json({
          created: created.length,
          skipped,
          hosts: created,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to import Nutanix VMs";
        res.status(502).json({ error: message });
      }
    },
  );
}
