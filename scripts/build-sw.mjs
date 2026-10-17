import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const assets = (await readdir("dist/assets")).map((f) => "./assets/" + f);
const version = createHash("sha256")
  .update(assets.join("|"))
  .digest("hex")
  .slice(0, 12);
let source = await readFile("public/sw.js", "utf8");
source = source
  .replace("dentum-shell-v1", "dentum-shell-" + version)
  .replace(
    /\["\.\/",\s*"\.\/index\.html"\]/,
    JSON.stringify(["./", "./index.html", ...assets]),
  );
await writeFile("dist/sw.js", source);
