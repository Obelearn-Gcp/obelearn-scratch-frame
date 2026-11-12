import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const Ajv = require("ajv");
const pack = require("ajv-pack");
const parserLib = join(root, "node_modules/scratch-parser/lib");
const workDir = join(root, ".cache/validators");

const schemas = {
  sb2: "sb2_schema.json",
  sb3: "sb3_schema.json",
  sprite2: "sprite2_schema.json",
  sprite3: "sprite3_schema.json",
};

export const buildValidators = async (outFile) => {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  for (const [name, file] of Object.entries(schemas)) {
    const ajv = new Ajv({ sourceCode: true });
    ajv.addSchema(require(join(parserLib, "sb2_definitions.json")));
    ajv.addSchema(require(join(parserLib, "sb3_definitions.json")));
    const validate = ajv.compile(require(join(parserLib, file)));
    writeFileSync(join(workDir, `${name}.cjs`), pack(ajv, validate));
  }

  const entry = Object.keys(schemas)
    .map((name) => `import ${name} from "./${name}.cjs";`)
    .concat(`globalThis.__obelearnScratchValidators = Object.freeze({ ${Object.keys(schemas).join(", ")} });`)
    .join("\n");
  writeFileSync(join(workDir, "entry.js"), entry);

  await build({
    entryPoints: [join(workDir, "entry.js")],
    outfile: outFile,
    bundle: true,
    format: "iife",
    platform: "browser",
    minify: true,
    legalComments: "none",
    nodePaths: [join(root, "node_modules")],
  });
};
