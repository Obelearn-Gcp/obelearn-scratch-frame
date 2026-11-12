import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const librariesDir = join(root, "node_modules/@scratch/scratch-gui/dist/libraries");
const outDir = join(root, ".cache/library-assets");
const CDN = "https://cdn.assets.scratch.mit.edu/internalapi/asset";
const CONCURRENCY = 8;

const collect = (node, found) => {
  if (Array.isArray(node)) {
    node.forEach((child) => collect(child, found));
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof node.md5ext === "string") found.add(node.md5ext);
  if (typeof node.assetId === "string" && typeof node.dataFormat === "string") {
    found.add(`${node.assetId}.${node.dataFormat}`);
  }
  Object.values(node).forEach((child) => collect(child, found));
};

const assets = new Set();
for (const name of ["sprites", "costumes", "backdrops", "sounds"]) {
  collect(JSON.parse(readFileSync(join(librariesDir, `${name}.json`), "utf8")), assets);
}

mkdirSync(outDir, { recursive: true });
const pending = [...assets].filter((file) => !existsSync(join(outDir, file)));
console.log(`library assets: ${assets.size} total, ${pending.length} to download`);

const failed = [];
const download = async (file) => {
  const response = await fetch(`${CDN}/${file}/get/`);
  if (!response.ok) throw new Error(`${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const expected = file.split(".")[0];
  const actual = createHash("md5").update(data).digest("hex");
  if (actual !== expected) throw new Error("checksum mismatch");
  writeFileSync(join(outDir, file), data);
};

let next = 0;
const worker = async () => {
  while (next < pending.length) {
    const file = pending[next++];
    try {
      await download(file);
    } catch (error) {
      failed.push(`${file}: ${error.message}`);
    }
  }
};
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (failed.length) {
  console.error(`failed: ${failed.length}`);
  failed.forEach((line) => console.error(`  ${line}`));
  process.exit(1);
}
console.log("library assets ready");
