export interface NutanixConfig {
  prismUrl: string;
  peUrl: string;
  username: string;
  password: string;
  allowInsecureTls: boolean;
  defaultFolder: string;
}

export interface NutanixCluster {
  uuid: string;
  name: string;
  aosVersion: string;
  externalIp: string;
  nodeCount: number;
  services: string[];
}

export interface NutanixVmTelemetry {
  cpuUsagePct: number | null;
  cpuReadyPct: number | null;
  memoryUsagePct: number | null;
  hostMemoryUsagePct: number | null;
  guestMemoryUsagePct: number | null;
  memoryUsedMb: number | null;
  diskCapacityBytes: number;
  diskUsedBytes: number | null;
  diskUsagePct: number | null;
  iops: number | null;
  ioBandwidthKbps: number | null;
  ioLatencyUs: number | null;
  rxBytes: number | null;
  txBytes: number | null;
}

export interface NutanixNodeVmSummary {
  uuid: string;
  name: string;
  powerState: "ON" | "OFF" | string;
  numVcpus: number;
  memoryMb: number;
  primaryIp: string | null;
  linkedHostId: number | null;
  telemetry: NutanixVmTelemetry;
}

export interface NutanixNodeVmOverview {
  total: number;
  running: number;
  stopped: number;
  linkedToTermix: number;
  allocatedVcpus: number;
  allocatedMemoryMb: number;
  vms: NutanixNodeVmSummary[];
}

export interface NutanixHost {
  uuid: string;
  name: string;
  clusterName: string;
  hypervisorAddress: string;
  controllerIp: string;
  hypervisorVersion: string;
  numCpuCores: number;
  numCpuSockets: number;
  cpuCapacityHz: number;
  memoryBytes: number;
  memoryUsedBytes: number;
  cpuUsagePct: number | null;
  memoryUsagePct: number | null;
  diskCapacityBytes: number;
  diskUsedBytes: number;
  diskFreeBytes: number;
  diskUsagePct: number | null;
  iops: number;
  ioBandwidthKbps: number;
  numVms: number;
  serial: string;
  state: string;
  vmOverview: NutanixNodeVmOverview;
}

export interface NutanixStorageContainer {
  uuid: string;
  name: string;
  clusterUuid: string;
  replicationFactor: number;
  compressionEnabled: boolean;
  capacityBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePct: number | null;
}

export interface NutanixVm {
  uuid: string;
  name: string;
  description: string;
  clusterName: string;
  hostUuid: string;
  hostName: string;
  powerState: "ON" | "OFF" | string;
  numVcpus: number;
  memoryMb: number;
  ipList: string[];
  primaryIp: string | null;
  linkedHostId: number | null;
  linkedHostName: string | null;
  telemetry: NutanixVmTelemetry;
}

export interface NutanixSummary {
  clusterCount: number;
  hostCount: number;
  containerCount: number;
  vmCount: number;
  runningVms: number;
  stoppedVms: number;
  totalCpuCores: number;
  cpuUsagePct: number | null;
  totalMemoryBytes: number;
  usedMemoryBytes: number;
  totalStorageBytes: number;
  usedStorageBytes: number;
}

export interface NutanixStatusResponse {
  configured: boolean;
  prismUrl: string;
  peUrl: string;
  error?: string;
  fetchedAt: string;
  summary: NutanixSummary;
  clusters: NutanixCluster[];
  hosts: NutanixHost[];
  containers: NutanixStorageContainer[];
  vms: NutanixVm[];
}
