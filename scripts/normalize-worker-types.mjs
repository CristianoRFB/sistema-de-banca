import { readFileSync, writeFileSync } from "node:fs";
import { URL } from "node:url";

const generatedTypes = new URL(
  "../cloudflare/worker/worker-configuration.d.ts",
  import.meta.url,
);
const source = readFileSync(generatedTypes, "utf8");

writeFileSync(generatedTypes, source.replace(/[\t ]+(?=\r?$)/gm, ""));
