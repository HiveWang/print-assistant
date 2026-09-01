import { spawn } from "node:child_process";
import path from "node:path";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("请通过 npm run dev 启动开发环境");
}

const projectRoot = path.resolve(import.meta.dirname, "..");
const environment = {
  ...process.env,
  NODE_ENV: "development",
};

const api = spawn(process.execPath, ["server/index.mjs"], {
  cwd: projectRoot,
  env: environment,
  stdio: "inherit",
});

const ui = spawn(process.execPath, [npmCli, "run", "dev:ui"], {
  cwd: projectRoot,
  env: environment,
  stdio: "inherit",
});

const children = [api, ui];
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping || signal === "SIGTERM") return;
    stop(code || 1);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
