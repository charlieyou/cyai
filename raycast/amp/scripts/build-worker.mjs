import { build } from "esbuild";
import { chmod, copyFile, mkdir, readFile, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const cliPackage = require.resolve("@ampcode/cli/package.json");
const manifest = JSON.parse(await readFile(cliPackage, "utf8"));
const assets = join(root, "assets");
await mkdir(assets, { recursive: true });
await copyFile(
  join(dirname(cliPackage), manifest.bin.amp),
  join(assets, "amp.tmp"),
);
await chmod(join(assets, "amp.tmp"), 0o755);
await rename(join(assets, "amp.tmp"), join(assets, "amp"));
await copyFile(
  join(dirname(cliPackage), "LICENSE.md"),
  join(assets, "amp-LICENSE.md"),
);
await build({
  entryPoints: [join(root, "src/launch-worker.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: join(assets, "launch-worker.mjs"),
});
console.log(
  `Bundled Amp ${manifest.version} for ${process.platform}/${process.arch}`,
);
