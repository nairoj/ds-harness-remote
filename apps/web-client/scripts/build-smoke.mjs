import { build } from "esbuild";
import { aliases } from "./aliases.mjs";
await build({
  entryPoints: ["scripts/live-smoke.ts"],
  outfile: ".private/live-smoke.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  alias: aliases,
});
