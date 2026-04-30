#!/usr/bin/env node
import { join } from "node:path";
import { ensureNativeDeps } from "./bootstrap.js";
const pluginRoot = ensureNativeDeps(import.meta.url);
const mainPath = join(pluginRoot, "dist", "server-main.js");
await import(mainPath);
