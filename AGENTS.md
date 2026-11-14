# Termix Nutanix plugin workspace guide

Read **[PLUGIN-GUIDE.md](./node_modules/@termix-ssh/plugin-sdk/PLUGIN-GUIDE.md)** in full when making plugin changes. It is the specification for Termix plugins and covers manifest, API 2 sandbox, capabilities, backend routes, operations, frontend UI kit, testing, and `authz.json`.

## About this plugin

- **Id**: `nutanix`
- **What it does**: Connects to Nutanix Prism Central (v3 API) and optional Prism Element (v2.0 API) via `ctx.fetch` (`network:outbound`) to display clusters, AHV hosts, storage containers, and virtual machines, link multi-NIC VMs to Termix hosts, import unlinked VMs, and control VM power state.
- **Capabilities**: `network:serve`, `network:outbound`, `hosts:read`, `hosts:write`, `ui:surface`, `operations:provide`.

## Before considering a change finished

1. Run `npm test`.
2. Run `npm run typecheck`.
3. Run `npm run validate` and check every warning.
4. Run `npm run build`.
5. Run `npm run format:check`.
6. Update `authz.json` and `docs/` whenever routes, settings, or permissions change.
