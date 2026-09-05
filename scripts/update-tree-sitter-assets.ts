/**
 * Download the tree-sitter parser assets declared in
 * `src/wrappers/parsers/config.ts` into `src/wrappers/parsers/<filetype>/`
 * (one wasm + one combined highlights query per filetype) and (re)generate the
 * asset loader at `src/wrappers/parsers/assets.ts`.
 *
 * Build-time only — run via `bun run parsers:update`. Never at app startup.
 */
import { updateAssets } from "@opentui/core/tree-sitter/update-assets";
import { join } from "node:path";

const parsersDir = join(import.meta.dir, "..", "src", "wrappers", "parsers");

await updateAssets({
  configPath: join(parsersDir, "config.ts"),
  assetsDir: parsersDir,
  outputPath: join(parsersDir, "assets.ts"),
});
