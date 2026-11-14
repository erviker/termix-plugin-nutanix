import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { clearInventoryCache } from "./prism.js";
import { registerOperations } from "./operations.js";
import { registerRoutes } from "./routes.js";

const CONFIG_KEYS = [
  "prismUrl",
  "peUrl",
  "username",
  "password",
  "allowInsecureTls",
  "defaultFolder",
];

export async function activate(ctx: PluginContext): Promise<void> {
  clearInventoryCache();
  for (const key of CONFIG_KEYS) {
    ctx.settings.onChange(key, () => {
      clearInventoryCache();
    });
  }
  registerRoutes(ctx.http.router<Router>(), ctx);
  registerOperations(ctx);
}

export async function deactivate(): Promise<void> {
  clearInventoryCache();
}
