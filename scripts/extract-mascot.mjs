import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("_reference/OpenMausBot/shared/mascot-bodies.ts", "utf8");
const start = src.indexOf("cursor: {");
const block = src.slice(start, src.indexOf("blob: {"));
const fit = block.match(/fit: "([^"]*)"/)[1];
const d = block.match(/d=\\"([^"\\]*)\\"/)[1];
writeFileSync(
  "web/lib/mascot-body.ts",
  `// Cursor body outline from OpenMausBot shared/mascot-bodies.ts (Apache-2.0).\nexport const CURSOR_FIT = ${JSON.stringify(fit)};\nexport const CURSOR_PATH = ${JSON.stringify(d)};\n`,
);
console.log(fit, d.length);
