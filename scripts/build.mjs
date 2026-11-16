import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildValidators } from "./build-validators.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gui = join(root, "node_modules/@scratch/scratch-gui/dist");
const out = join(root, "build");
const libraryAssets = join(root, ".cache/library-assets");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const guiPkg = JSON.parse(readFileSync(join(root, "node_modules/@scratch/scratch-gui/package.json"), "utf8"));

if (!existsSync(libraryAssets) || readdirSync(libraryAssets).length === 0) {
  console.error("missing library assets, run: npm run fetch-assets");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const skipMaps = (source) => !source.endsWith(".map");

const patches = [
  ['__webpack_require__.p="/"', '__webpack_require__.p=""'],
  ['.p="/",', '.p="",'],
  ['solutionPath:"/chunks/mediapipe/', 'solutionPath:"chunks/mediapipe/'],
];
let bundle = readFileSync(join(gui, "scratch-gui-standalone.js"), "utf8");
for (const [from, to] of patches) {
  if (!bundle.includes(from)) {
    console.error(`patch target not found: ${from}`);
    process.exit(1);
  }
  bundle = bundle.split(from).join(to);
}

const parserValidate =
  /var (\w+)=\w+\(\d+\)\(\),(?:\w+=\w+\(\d+\),){5}\w+=\w+\(\d+\);\1\.addSchema\(\w+\)\.addSchema\(\w+\),(\w+)\.exports=function\((\w+),(\w+),(\w+)\)\{var (\w+)=\1\.compile\(\3\?\w+:\w+\),(\w+)=\1\.compile\(\3\?\w+:\w+\);/g;
const validateMatches = bundle.match(parserValidate) || [];
if (validateMatches.length !== 1) {
  console.error(`scratch-parser validate module matched ${validateMatches.length} times, expected 1`);
  process.exit(1);
}
bundle = bundle.replace(
  parserValidate,
  "var $1=globalThis.__obelearnScratchValidators;$2.exports=function($3,$4,$5){var $6=$3?$1.sprite2:$1.sb2,$7=$3?$1.sprite3:$1.sb3;",
);
writeFileSync(join(out, "scratch-gui-standalone.js"), bundle);

await buildValidators(join(out, "parser-validators.js"));
if (/new Function|\beval\(/.test(readFileSync(join(out, "parser-validators.js"), "utf8"))) {
  console.error("parser-validators.js must not use eval or new Function");
  process.exit(1);
}

cpSync(join(gui, "scratch-gui-standalone.js.LICENSE.txt"), join(out, "scratch-gui-standalone.js.LICENSE.txt"));
cpSync(join(gui, "extension-worker.js"), join(out, "extension-worker.js"));
cpSync(join(gui, "chunks"), join(out, "chunks"), { recursive: true, filter: skipMaps });
cpSync(join(gui, "static"), join(out, "static"), { recursive: true, filter: skipMaps });
for (const file of readdirSync(gui).filter((name) => name.endsWith(".hex"))) {
  cpSync(join(gui, file), join(out, file));
}
cpSync(libraryAssets, join(out, "library-assets"), { recursive: true });

for (const file of ["index.html", "frame-guard.js", "sandbox-shims.js", "frame.js", "frame.css"]) {
  cpSync(join(root, "src", file), join(out, file));
}
cpSync(join(root, "LICENSE"), join(out, "LICENSE.txt"));
cpSync(join(root, "TRADEMARK"), join(out, "TRADEMARK.txt"));

writeFileSync(
  join(out, "version.json"),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      scratchGui: guiPkg.version,
      license: pkg.license,
      source: "https://github.com/Obelearn-Gcp/obelearn-scratch-frame",
    },
    null,
    2,
  )}\n`,
);

console.log(`built ${pkg.name}@${pkg.version} (scratch-gui ${guiPkg.version}) into build/`);
