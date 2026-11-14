# Changelog

## 1.0.0

### Added

- Initial release of the Nutanix plugin for Termix (`nutanix`).
- Prism Central v3 inventory for clusters, AHV hosts, and virtual machines.
- Per-node CPU, RAM, disk usage, and expandable VM overview cards on the Overview tab.
- Per-VM CPU, RAM, vDisk, and storage controller IOPS/bandwidth telemetry in both the VMs view and node VM overviews.
- Optional Prism Element v1/v2 telemetry for per-host CPU/memory/disk usage, VM controller stats fallback, and storage containers.
- Multi-NIC IP and case-insensitive host matching between Nutanix VMs and Termix hosts.
- VM power control (`ON` and `OFF`) with audit logging and Operations Center integration.
- Bulk and per-VM host import into a configurable Termix host folder.
