<div align="center">

<h1>Termix Nutanix Plugin</h1>

<p>Monitor Nutanix Prism clusters, AHV hosts, storage containers, and virtual machines from Termix, control VM power states, and import VMs directly into your host inventory.</p>

<p>
  <a href="https://scorecard.dev/viewer/?uri=github.com/erviker/termix-plugin-nutanix"><img alt="OpenSSF Scorecard" src="https://img.shields.io/ossf-scorecard/github.com/erviker/termix-plugin-nutanix?label=OpenSSF%20Scorecard&style=flat&color=F39044&labelColor=1a1a1a" /></a>
</p>

</div>

## Overview

`termix-plugin-nutanix` adds first-class Nutanix Prism Central (v3 API) and optional Prism Element (v2.0 API) integration to [Termix](https://github.com/Termix-SSH/Termix).

## Features

- **Infrastructure Inventory:** Live summary of clusters, AHV hypervisor hosts, storage containers, memory usage, and storage capacity.
- **Smart Termix Host Matching:** Matches VMs across all discovered NIC IP addresses with a case-insensitive name fallback, providing direct **Open Terminal** actions from the VM table.
- **VM Power Control:** Power VMs ON and OFF with Prism optimistic-locking checks, RBAC enforcement (`nutanix.manage`), and Termix audit logging.
- **One-Click VM Import:** Import discovered VMs that are not yet in Termix into a configurable folder (`Nutanix VMs` by default).
- **Operations Center Actions:** Exposes `nutanix.summary`, `nutanix.list-vms`, and `nutanix.power-vm` for automations and scripts.

## Configuration

In Termix, go to **Settings -> Plugins -> Nutanix** and configure:

| Setting            | Required | Description                                                                                     |
| :----------------- | :------: | :---------------------------------------------------------------------------------------------- |
| `prismUrl`         |   Yes    | Base URL of Prism Central (e.g. `https://prism.example.com:9440`)                               |
| `peUrl`            |    No    | Optional Prism Element URL for storage containers and AHV telemetry                             |
| `username`         |   Yes    | Prism API username                                                                              |
| `password`         |   Yes    | Prism API password (stored encrypted)                                                           |
| `allowInsecureTls` |    No    | Accept self-signed certificates when disabled TLS verification is required (`false` by default) |
| `defaultFolder`    |    No    | Termix host folder used when importing VMs (`Nutanix VMs` by default)                           |

## Permissions

- `nutanix.view` (`admin`, `user` by default): Open the Nutanix tab and read inventory.
- `nutanix.manage` (`admin` by default): Toggle VM power state and import VMs as Termix hosts.

## Development

```bash
npm ci
npm run build
npm test
npm run typecheck
npm run validate
npm run format:check
```

## License

Apache-2.0
