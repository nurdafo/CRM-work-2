import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const line = readFileSync(".dev.vars", "utf8").split(/\r?\n/).find((item) => item.trimStart().startsWith("CRM_PASSWORD="));
if (!line) throw new Error("CRM_PASSWORD is missing from .dev.vars");
let password = line.slice(line.indexOf("=") + 1).trim();
if ((password.startsWith('"') && password.endsWith('"')) || (password.startsWith("'") && password.endsWith("'"))) password = password.slice(1, -1);
if (!password) throw new Error("CRM_PASSWORD is empty");

const executable = process.platform === "win32" ? "npx wrangler secret put CRM_PASSWORD" : "npx wrangler secret put CRM_PASSWORD";
const result = spawnSync(executable, [], {
  cwd: process.cwd(),
  input: Buffer.from(`${password}\n`, "utf8"),
  encoding: "utf8",
  windowsHide: true,
  shell: true,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) throw new Error(`Wrangler exited with code ${result.status}: ${result.error?.message ?? "unknown error"}`);
