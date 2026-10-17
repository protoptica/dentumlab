import { spawn } from "node:child_process";
import { mkdir, rename, writeFile, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
const dir = process.env.BACKUP_DIR;
if (!dir) throw Error("Укажите BACKUP_DIR — отдельный закрытый каталог");
const destination = resolve(dir);
await mkdir(destination, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const final = join(destination, `procurement-${stamp}.dump`),
  temp = final + ".partial",
  statusFile = join(destination, "status.json");
let previous = {};
try {
  previous = JSON.parse(await readFile(statusFile, "utf8"));
} catch {}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, {
      stdio: ["ignore", "ignore", "ignore"],
      env: process.env,
    });
    p.on("error", () => reject(Error("Клиент PostgreSQL недоступен")));
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Экспорт PostgreSQL не выполнен")),
    );
  });
}
try {
  await run("pg_dump", [
    "--format=custom",
    "--schema=public",
    "--no-owner",
    "--no-acl",
    "--file",
    temp,
  ]);
  await rename(temp, final);
  await writeFile(
    statusFile,
    JSON.stringify(
      { status: "ok", last_success: new Date().toISOString(), file: final },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("Резервная копия создана");
} catch {
  await unlink(temp).catch(() => {});
  await writeFile(
    statusFile,
    JSON.stringify(
      {
        ...previous,
        status: "error",
        last_attempt: new Date().toISOString(),
        error: "Экспорт не выполнен. Проверьте соединение и PostgreSQL client.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.error("Резервная копия не создана");
  process.exitCode = 1;
}
