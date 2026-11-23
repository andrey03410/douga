import { build } from "esbuild";
import path from "node:path";

await build({
  entryPoints: ["src/watch/standalone.tsx"], bundle: true, format: "iife", platform: "browser",
  jsx: "automatic", minify: true, alias: { "@": path.resolve("src") },
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: "node_modules/.cache/douga-html/player.js",
});
