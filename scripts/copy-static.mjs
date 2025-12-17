/**
 * Copy static extension assets into the build output directory.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const source = join(cwd, "static");
const destination = join(cwd, "dist");

if (!existsSync(source)) {
  console.warn("[copy-static] No static directory found. Skipping copy.");
  process.exit(0);
}

mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
console.log("[copy-static] Static assets copied to dist.");

