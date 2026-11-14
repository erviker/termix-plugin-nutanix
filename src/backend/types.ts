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

export interface NutanixHost {
  uuid: string;
  name: string;
  clusterName: string;
  controllerIp: string;
  hypervisorVersion: string;
  numCpuCores: number;
  numCpuSockets: number;
  memoryBytes: number;
  cpuUsagePct: number | null;
  memoryUsagePct: number | null;
  numVms: number;
  serial: string;
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
  hostName: string;
  powerState: "ON" | "OFF" | string;
  numVcpus: number;
  memoryMb: number;
  ipList: string[];
  primaryIp: string | null;
  linkedHostId: number | null;
  linkedHostName: string | null;
}

export interface NutanixSummary {
  clusterCount: number;
  hostCount: number;
  containerCount: number;
  vmCount: number;
  runningVms: number;
  stoppedVms: number;
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
