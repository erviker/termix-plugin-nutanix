# Contributing to Nutanix Plugin

## Development

```bash
npm run build        # bundle backend, frontend, and openapi into dist/
npm run test         # run backend and frontend Vitest suites
npm run typecheck    # run TypeScript type checking
npm run validate     # validate manifest.json, authz, package, and changelog
npm run pack         # build nutanix-<version>.tmxplug archive
npm run format       # format files with Prettier
```

## Docs

User-facing documentation lives in [docs/](docs/), and `docs` in `manifest.json` links to it. Settings, permissions, operations, and API endpoints are generated automatically from `manifest.json` and `@openapi` JSDoc blocks in `src/backend/routes.ts`.
