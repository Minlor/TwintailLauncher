import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const rendererUrl = "http://localhost:1420";
const packageManagerExec = process.env.npm_execpath;
const nativeBinaryPath = path.join(projectRoot, "launcher-sidecar", "target", "release", process.platform === "win32" ? "launcher-sidecar.exe" : "launcher-sidecar");

function newestMtimeMs(targetPath) {
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }
  let newest = stat.mtimeMs;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    newest = Math.max(newest, newestMtimeMs(path.join(targetPath, entry.name)));
  }
  return newest;
}

function shouldBuildNativeBackend() {
  if (!fs.existsSync(nativeBinaryPath)) {
    return true;
  }
  const binaryMtime = fs.statSync(nativeBinaryPath).mtimeMs;
  const newestSource = Math.max(
    newestMtimeMs(path.join(projectRoot, "launcher-core", "src")),
    newestMtimeMs(path.join(projectRoot, "launcher-sidecar", "src")),
    fs.statSync(path.join(projectRoot, "launcher-core", "Cargo.toml")).mtimeMs,
    fs.statSync(path.join(projectRoot, "launcher-sidecar", "Cargo.toml")).mtimeMs,
  );
  return newestSource > binaryMtime;
}

function startDevServerProcess() {
  return spawnPackageManager(["dev"], { stdio: "inherit" });
}

function spawnPackageManager(args, options = {}) {
  if (packageManagerExec && /\.(c?js|mjs)$/i.test(packageManagerExec)) {
    return spawn(process.execPath, [packageManagerExec, ...args], {
      cwd: projectRoot,
      env: process.env,
      ...options,
    });
  }

  if (packageManagerExec) {
    return spawn(packageManagerExec, args, {
      cwd: projectRoot,
      env: process.env,
      ...options,
    });
  }

  return spawn("pnpm", args, {
      cwd: projectRoot,
      env: process.env,
      shell: process.platform === "win32",
      ...options,
    });
}

function runPackageManager(args) {
  return new Promise((resolve, reject) => {
    const child = spawnPackageManager(args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Package manager command failed: ${["pnpm", ...args].join(" ")} (exit code ${code ?? 1})`));
    });
    child.on("error", reject);
  });
}

function loadElectronBinary() {
  const electronBinary = require("electron");
  if (typeof electronBinary !== "string" || !electronBinary || !fs.existsSync(electronBinary)) {
    throw new Error("Electron is installed but the executable is missing.");
  }
  return electronBinary;
}

async function resolveElectronBinary() {
  try {
    return loadElectronBinary();
  } catch (error) {
    console.warn("Electron is missing its downloaded runtime. Attempting to repair the local install...");
    await runPackageManager(["rebuild", "electron"]);
    try {
      return loadElectronBinary();
    } catch {
      const recoveryHint = packageManagerExec ? "Run `pnpm rebuild electron` or reinstall dependencies with `pnpm install`." : "Reinstall dependencies so Electron can download its runtime.";
      throw new Error(`Electron failed to install correctly. ${recoveryHint}`);
    }
  }
}

let viteChild = null;
let electronChild = null;
let shuttingDown = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isRendererHealthy() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(rendererUrl, { signal: controller.signal });
    if (!response.ok) {
      return false;
    }
    const body = await response.text();
    return body.includes("<div id=\"root\">") || body.includes("Twintail Launcher");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (electronChild && !electronChild.killed) {
    electronChild.kill();
  }
  if (viteChild && !viteChild.killed) {
    viteChild.kill();
  }
  process.exit(code);
}

async function startElectron() {
  const electronBinary = await resolveElectronBinary();
  const electronEnv = {
    ...process.env,
    ELECTRON_RENDERER_URL: rendererUrl,
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  electronChild = spawn(electronBinary, ["electron/main.mjs"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: electronEnv,
  });

  electronChild.on("exit", (code, signal) => {
    if (signal) {
      shutdown(1);
      return;
    }
    shutdown(code ?? 0);
  });
}

function runCargoBuild() {
  if (!shouldBuildNativeBackend()) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cargo = spawn(process.platform === "win32" ? "cargo.exe" : "cargo", ["build", "--release", "--manifest-path", path.join(projectRoot, "launcher-sidecar", "Cargo.toml")], {
      cwd: projectRoot,
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });
    cargo.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`cargo build failed with exit code ${code ?? 1}`));
    });
    cargo.on("error", reject);
  });
}

async function ensureRenderer() {
  if (await isRendererHealthy()) {
    return;
  }

  viteChild = startDevServerProcess();

  let viteExited = false;
  viteChild.on("exit", (code) => {
    viteExited = true;
    if (!electronChild) {
      shutdown(code ?? 1);
    }
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 60000) {
    if (viteExited) {
      throw new Error("Vite dev server exited before Electron could connect.");
    }
    if (await isRendererHealthy()) {
      return;
    }
    await wait(500);
  }

  throw new Error(`Timed out waiting for Vite at ${rendererUrl}`);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

try {
  await ensureRenderer();
  await runCargoBuild();
  await startElectron();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
}
