import { defineConfig } from "tsup";

/**
 * Build configuration bundling background, content, and options scripts for the extension.
 */
export default defineConfig({
  entry: {
    background: "src/background/index.ts",
    content: "src/content/index.ts",
    options: "src/options/index.ts"
  },
  outDir: "dist",
  format: ["esm"],
  noExternal: ["html2canvas"],
  splitting: false,
  sourcemap: true,
  clean: false,
  minify: false,
  dts: false,
  target: "es2022",
  shims: false
});

