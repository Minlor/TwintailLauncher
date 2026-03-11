import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

function resolveSidecarCommand({ projectRoot, packaged }) {
  if (process.env.TTL_SIDECAR_BIN) {
    return { command: process.env.TTL_SIDECAR_BIN, args: [] };
  }

  const binaryName = process.platform === "win32" ? "launcher-sidecar.exe" : "launcher-sidecar";
  const devBinary = path.join(projectRoot, "launcher-sidecar", "target", "release", binaryName);
  if (!packaged && fs.existsSync(devBinary)) {
    return { command: devBinary, args: [] };
  }

  if (packaged) {
    return { command: path.join(process.resourcesPath, "bin", binaryName), args: [] };
  }

  return {
    command: process.platform === "win32" ? "cargo.exe" : "cargo",
    args: ["run", "--quiet", "--manifest-path", path.join(projectRoot, "launcher-sidecar", "Cargo.toml")],
  };
}

function hideWindowsProcessWindow(pid) {
  if (process.platform !== "win32") {
    return;
  }
  const script = [
    "$signature = @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class Win32Bridge {",
    "  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);",
    "  [DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);",
    "}",
    "'@;",
    "Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null;",
    "$swpFlags = 0x0080 -bor 0x0004 -bor 0x0010;",
    `while ($true) { $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (!$p) { break; } if ($p.MainWindowHandle -ne 0) { [Win32Bridge]::SetWindowPos([intptr]$p.MainWindowHandle, [intptr]::Zero, -32000, -32000, 0, 0, $swpFlags) | Out-Null; [Win32Bridge]::ShowWindow([intptr]$p.MainWindowHandle, 0) | Out-Null; } Start-Sleep -Milliseconds 250 }`,
  ].join(" ");
  const helper = spawn("powershell.exe", ["-NoLogo", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
    stdio: "ignore",
    windowsHide: true,
  });
  helper.unref();
}

export class SidecarClient {
  constructor({ projectRoot, packaged, env = {}, onEvent, onExit }) {
    this.projectRoot = projectRoot;
    this.packaged = packaged;
    this.env = env;
    this.onEvent = onEvent;
    this.onExit = onExit;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.ready = false;
  }

  async start() {
    if (this.child) {
      return;
    }

    const { command, args } = resolveSidecarCommand({ projectRoot: this.projectRoot, packaged: this.packaged });
    if (this.packaged && !fs.existsSync(command)) {
      throw new Error(`Electron sidecar binary not found at ${command}`);
    }

    let readyResolve;
    let readyReject;
    const readyPromise = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });

    this.child = spawn(command, args, {
      cwd: this.projectRoot,
      env: { ...process.env, TTL_BRIDGE_STDIO: "1", ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    hideWindowsProcessWindow(this.child.pid);

    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      if (!trimmed.startsWith("{")) {
        console.log("[sidecar:stdout]", trimmed);
        return;
      }
      let message;
      try {
        message = JSON.parse(trimmed);
      } catch (error) {
        console.error("Invalid sidecar JSON message:", trimmed, error);
        return;
      }
      if (message.method === "event") {
        if (message.params?.event_name === "sidecar_ready") {
          this.ready = true;
          readyResolve?.();
          return;
        }
        this.onEvent?.(message.params?.event_name, message.params?.payload);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "Unknown sidecar error"));
      } else {
        pending.resolve(message.result);
      }
    });

    this.child.stderr.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) {
        console.error("[sidecar]", message);
      }
    });

    this.child.on("exit", (code, signal) => {
      if (!this.ready) {
        readyReject?.(new Error(`Electron sidecar exited before becoming ready (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}).`));
      }
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Electron sidecar exited before responding."));
      }
      this.pending.clear();
      this.child = null;
      this.onExit?.({ code, signal });
    });

    await Promise.race([
      readyPromise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Electron sidecar did not become ready in time.")), 120000);
      }),
    ]);
  }

  async invoke(command, payload = {}) {
    return this.call("runtime.invoke", { command, payload });
  }

  async emit(eventName, payload = null) {
    return this.call("runtime.emit", { event_name: eventName, payload });
  }

  async stop() {
    if (!this.child) {
      return;
    }
    this.child.kill();
    this.child = null;
    this.ready = false;
  }

  async call(method, params) {
    if (!this.child) {
      throw new Error("Electron sidecar is not running.");
    }
    const id = this.nextId++;
    const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${message}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }
}
