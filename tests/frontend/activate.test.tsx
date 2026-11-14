import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const SAMPLE_STATUS = {
  configured: true,
  prismUrl: "https://prism.example.test:9440",
  peUrl: "https://pe.example.test:9440",
  fetchedAt: "2026-11-14T18:00:00.000Z",
  summary: {
    clusterCount: 1,
    hostCount: 1,
    containerCount: 1,
    vmCount: 2,
    runningVms: 1,
    stoppedVms: 1,
    totalMemoryBytes: 137_438_953_472,
    usedMemoryBytes: 68_719_476_736,
    totalStorageBytes: 10_000_000_000_000,
    usedStorageBytes: 2_500_000_000_000,
  },
  clusters: [
    {
      uuid: "c-1",
      name: "prod-ahv-01",
      aosVersion: "6.8.1",
      externalIp: "10.0.0.11",
      nodeCount: 1,
      services: ["AOS"],
    },
  ],
  hosts: [
    {
      uuid: "h-1",
      name: "ahv-node-01",
      clusterName: "prod-ahv-01",
      controllerIp: "10.0.0.21",
      hypervisorVersion: "AHV 20230302",
      numCpuCores: 32,
      numCpuSockets: 2,
      memoryBytes: 137_438_953_472,
      cpuUsagePct: 22,
      memoryUsagePct: 50,
      numVms: 2,
      serial: "SN-01",
    },
  ],
  containers: [
    {
      uuid: "sc-1",
      name: "default-container",
      clusterUuid: "c-1",
      replicationFactor: 2,
      compressionEnabled: true,
      capacityBytes: 10_000_000_000_000,
      usedBytes: 2_500_000_000_000,
      freeBytes: 7_500_000_000_000,
      usagePct: 25,
    },
  ],
  vms: [
    {
      uuid: "vm-1",
      name: "app-01",
      description: "",
      clusterName: "prod-ahv-01",
      hostName: "ahv-node-01",
      powerState: "ON",
      numVcpus: 4,
      memoryMb: 8192,
      ipList: ["10.0.1.10"],
      primaryIp: "10.0.1.10",
      linkedHostId: 42,
      linkedHostName: "app-01",
    },
    {
      uuid: "vm-2",
      name: "db-new",
      description: "",
      clusterName: "prod-ahv-01",
      hostName: "ahv-node-01",
      powerState: "OFF",
      numVcpus: 2,
      memoryMb: 4096,
      ipList: ["10.0.1.20"],
      primaryIp: "10.0.1.20",
      linkedHostId: null,
      linkedHostName: null,
    },
  ],
};

describe(`${manifest.id} activate`, () => {
  it("registers the rail item and tab", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["nutanix"]);
    expect(rendered.registered.railItems()).toEqual([
      expect.objectContaining({
        id: "nutanix",
        permission: "nutanix.view",
      }),
    ]);
  });

  it("shows a setup notice when Nutanix is not configured", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: {
        get: vi.fn(async () => ({
          data: { ...SAMPLE_STATUS, configured: false, vms: [] },
        })),
      } as never,
    });
    rendered.renderTab("nutanix", { isVisible: true });
    expect(
      await screen.findByText(locales.tab.notConfiguredTitle),
    ).toBeTruthy();
  });

  it("renders VMs, filters search, and triggers import/power when permitted", async () => {
    const postMock = vi.fn(async (path: string) => {
      if (path === "/import-vms") {
        return { data: { created: 1, skipped: 0 } };
      }
      return { data: { success: true } };
    });

    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      permissions: ["nutanix.view", "nutanix.manage"],
      api: {
        get: vi.fn(async () => ({ data: SAMPLE_STATUS })),
        post: postMock,
      } as never,
    });

    rendered.renderTab("nutanix", { isVisible: true });
    expect(await screen.findByText("db-new")).toBeTruthy();
    expect(screen.getAllByText("app-01").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText(locales.tab.importAll));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/import-vms", {});
    });

    fireEvent.click(screen.getByText(locales.tab.vm.powerOff));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/vms/vm-1/power", {
        state: "OFF",
      });
    });

    // Switch sub-views
    fireEvent.click(screen.getByText(locales.tab.tabs.containers));
    expect(await screen.findByText("default-container")).toBeTruthy();
  });
});
