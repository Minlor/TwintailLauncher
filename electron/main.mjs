import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SidecarClient } from "./sidecar-client.mjs";

const require = createRequire(import.meta.url);
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require("electron");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const rendererDist = path.join(projectRoot, "dist", "index.html");
const rendererDevUrl = process.env.ELECTRON_RENDERER_URL ?? "http://localhost:1420";
const appName = "TwintailLauncher";
const appId = "app.twintaillauncher.desktop";

app.setName(appName);
app.setAppUserModelId(appId);

const baseDataDir = resolveBaseDataDir();
app.setPath("userData", path.join(baseDataDir, "Electron"));

const runtimePaths = {
  electronUserDataDir: app.getPath("userData"),
  launcherDataDir: baseDataDir,
};

let mainWindow = null;
let tray = null;
let trayMenu = null;
let sidecar = null;
let isQuitting = false;
let rendererReady = false;
const bufferedEvents = [];
const dialogCallbacks = new Map();
const pendingInstallLaunchId = extractInstallId(process.argv);
let launchedFromShortcut = Boolean(pendingInstallLaunchId);

function resolveBaseDataDir() {
  if (process.platform === "win32") {
    return path.join(app.getPath("appData"), "twintaillauncher");
  }
  return path.join(app.getPath("home"), ".local", "share", "twintaillauncher");
}

function extractInstallId(argv = []) {
  for (const arg of argv) {
    if (typeof arg !== "string") {
      continue;
    }
    if (arg.startsWith("--install=")) {
      return arg.slice("--install=".length);
    }
  }
  return null;
}

function quoteShellArg(arg) {
  if (!arg) {
    return "\"\"";
  }
  if (!/[\s"\\]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function resolveShellLaunchConfig() {
  const executable = app.getPath("exe");
  const argsPrefix = app.isPackaged ? [] : [projectRoot];
  const command = [executable, ...argsPrefix].map((part) => quoteShellArg(part)).join(" ");
  return { executable, argsPrefix, command };
}

function ensureRuntimeDirs() {
  fs.mkdirSync(runtimePaths.electronUserDataDir, { recursive: true });
  fs.mkdirSync(runtimePaths.launcherDataDir, { recursive: true });
}

function getWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  return null;
}

function getIconPath() {
  const filename = process.platform === "win32" ? "icon.ico" : "128x128.png";
  return path.join(projectRoot, "assets", "icons", filename);
}

function updateTrayToggleLabel(visible) {
  if (!trayMenu || !tray) {
    return;
  }
  const toggleItem = trayMenu.items.find((item) => item.id === "tray-toggle");
  if (!toggleItem) {
    return;
  }
  toggleItem.label = visible ? "Hide" : "Show";
  tray.setContextMenu(trayMenu);
}

function sendRuntimeEvent(eventName, payload) {
  const win = getWindow();
  if (!rendererReady || !win) {
    bufferedEvents.push({ eventName, payload });
    return;
  }
  win.webContents.send("ttl:event", { eventName, payload });
}

function flushBufferedEvents() {
  const win = getWindow();
  if (!rendererReady || !win) {
    return;
  }
  while (bufferedEvents.length > 0) {
    win.webContents.send("ttl:event", bufferedEvents.shift());
  }
}

function isRendererPage(url) {
  if (!url) {
    return false;
  }
  if (url.startsWith("data:text/html")) {
    return false;
  }
  if (!app.isPackaged) {
    return url.startsWith(rendererDevUrl);
  }
  return url.endsWith("/dist/index.html") || url.startsWith("file:");
}

function registerDialogCallback(callbackId, handler) {
  dialogCallbacks.set(callbackId, handler);
}

async function handleDialogResponse(payload) {
  const callbackId = payload?.callback_id;
  if (!callbackId || !dialogCallbacks.has(callbackId)) {
    return false;
  }
  const handler = dialogCallbacks.get(callbackId);
  dialogCallbacks.delete(callbackId);
  await handler(payload?.button_index ?? -1);
  return true;
}

function getBootHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>TwintailLauncher</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at top, rgba(240,107,41,0.22), transparent 35%),
        radial-gradient(circle at bottom, rgba(38,135,255,0.18), transparent 38%),
        linear-gradient(160deg, #120d19 0%, #1b1526 55%, #09070d 100%);
      color: #f4efe8;
      font: 15px/1.4 "Segoe UI", system-ui, sans-serif;
    }
    .shell {
      width: min(520px, calc(100vw - 48px));
      padding: 28px 30px;
      border-radius: 22px;
      background: rgba(12, 10, 18, 0.72);
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: 0 24px 70px rgba(0,0,0,0.45);
      backdrop-filter: blur(18px);
    }
    .eyebrow { color: #ffb27a; font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; }
    h1 { margin: 10px 0 10px; font-size: 28px; font-weight: 700; }
    p { margin: 0; color: rgba(244,239,232,0.72); }
    .bar { margin-top: 22px; height: 10px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,0.08); }
    .bar > span {
      display: block; height: 100%; width: 38%;
      background: linear-gradient(90deg, #ff7a18 0%, #ffb36a 45%, #4fa3ff 100%);
      animation: slide 1.6s ease-in-out infinite;
      border-radius: inherit;
    }
    @keyframes slide {
      0% { transform: translateX(-120%); }
      100% { transform: translateX(360%); }
    }
    .note { margin-top: 14px; font-size: 12px; color: rgba(244,239,232,0.48); }
  </style>
</head>
<body>
  <main class="shell">
    <div class="eyebrow">Electron Shell</div>
    <h1>Starting launcher backend</h1>
    <p>The Electron shell is preparing the Rust launcher service and loading your profile.</p>
    <div class="bar"><span></span></div>
    <div class="note">The backend window stays hidden during this phase.</div>
  </main>
</body>
</html>`;
}

async function loadBootScreen() {
  const win = getWindow();
  if (!win) {
    return;
  }
  rendererReady = false;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getBootHtml())}`);
}

async function loadRenderer() {
  const win = getWindow();
  if (!win) {
    return;
  }
  rendererReady = false;
  if (app.isPackaged) {
    await win.loadFile(rendererDist);
  } else {
    await win.loadURL(rendererDevUrl);
  }
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(getIconPath());
  tray = new Tray(trayIcon);
  trayMenu = Menu.buildFromTemplate([
    {
      id: "tray-toggle",
      label: "Hide",
      click: () => {
        const win = getWindow();
        if (!win) {
          return;
        }
        if (win.isVisible()) {
          win.hide();
          updateTrayToggleLabel(false);
        } else {
          win.show();
          win.focus();
          updateTrayToggleLabel(true);
        }
      },
    },
    {
      id: "tray-force-kill",
      label: "Force kill",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip(appName);
  tray.setContextMenu(trayMenu);
  tray.on("click", () => {
    const win = getWindow();
    if (!win) {
      return;
    }
    win.show();
    win.focus();
    updateTrayToggleLabel(true);
  });
}

async function handleShellInvoke(command, payload = {}) {
  switch (command) {
    case "open_uri":
      if (typeof payload.uri === "string" && payload.uri) {
        await shell.openExternal(payload.uri);
      }
      return true;
    default:
      return sidecar.invoke(command, payload);
  }
}

async function handleRuntimeEmit(eventName, payload) {
  if (eventName === "launcher_action_exit") {
    isQuitting = true;
    app.quit();
    return;
  }

  if (eventName === "launcher_action_minimize") {
    getWindow()?.minimize();
    return;
  }

  if (eventName === "dialog_response" && await handleDialogResponse(payload)) {
    return;
  }

  if (eventName === "sync_tray_toggle") {
    updateTrayToggleLabel(String(payload ?? "").toLowerCase() !== "show");
    return;
  }

  return sidecar.emit(eventName, payload);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: "#140f1e",
    autoHideMenuBar: true,
    show: false,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.on("did-finish-load", async () => {
    if (!isRendererPage(mainWindow.webContents.getURL())) {
      return;
    }
    rendererReady = true;
    flushBufferedEvents();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
    updateTrayToggleLabel(false);
  });

  mainWindow.on("show", () => updateTrayToggleLabel(true));
  mainWindow.on("hide", () => updateTrayToggleLabel(false));

  void loadBootScreen();

  mainWindow.once("ready-to-show", () => {
    if (!launchedFromShortcut) {
      mainWindow.show();
    }
  });
}

async function startSidecar() {
  const shellLaunch = resolveShellLaunchConfig();
  const resourceDir = app.isPackaged ? process.resourcesPath : projectRoot;
  sidecar = new SidecarClient({
    projectRoot,
    packaged: app.isPackaged,
    env: {
      TTL_DATA_DIR: runtimePaths.launcherDataDir,
      TTL_SHELL_RUNTIME: "electron",
      TTL_RESOURCE_DIR: resourceDir,
      ...(!app.isPackaged ? { TTL_DEV: "1" } : {}),
      TTL_SHELL_EXECUTABLE: shellLaunch.executable,
      TTL_SHELL_ARGS_PREFIX: JSON.stringify(shellLaunch.argsPrefix),
      TTL_SHELL_COMMAND: shellLaunch.command,
    },
    onEvent(eventName, payload) {
      if (eventName === "sync_tray_toggle") {
        updateTrayToggleLabel(String(payload ?? "").toLowerCase() !== "show");
        return;
      }
      sendRuntimeEvent(eventName, payload);
    },
    onExit({ code, signal }) {
      const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      sendRuntimeEvent("show_dialog", {
        dialog_type: "error",
        title: "Launcher Sidecar Exited",
        message: `The Rust sidecar stopped unexpectedly (${reason}). Restart TwintailLauncher to continue.`,
        buttons: ["OK"],
      });
    },
  });
  await sidecar.start();
}

async function triggerInstallLaunch(installId, options = {}) {
  if (!installId) {
    return;
  }
  launchedFromShortcut = Boolean(options.fromShortcut);
  if (options.hideWindow) {
    getWindow()?.hide();
  }
  try {
    await sidecar.invoke("game_launch", { id: installId });
  } catch (error) {
    launchedFromShortcut = false;
    getWindow()?.show();
    getWindow()?.focus();
    sendRuntimeEvent("show_dialog", {
      dialog_type: "error",
      title: "Launch Failed",
      message: `Failed to launch the selected install: ${error instanceof Error ? error.message : String(error)}`,
      buttons: ["OK"],
    });
  }
}

ipcMain.handle("ttl:invoke", async (_event, { command, payload }) => handleShellInvoke(command, payload ?? {}));
ipcMain.handle("ttl:emit", async (_event, { eventName, payload }) => handleRuntimeEmit(eventName, payload));
ipcMain.handle("ttl:dialog:open", async (_event, options = {}) => {
  const properties = [];
  if (options.directory) {
    properties.push("openDirectory");
  } else {
    properties.push("openFile");
  }
  if (options.multiple) {
    properties.push("multiSelections");
  }
  const result = await dialog.showOpenDialog(getWindow() ?? undefined, {
    defaultPath: options.defaultPath,
    properties,
    filters: options.filters,
  });
  if (result.canceled) {
    return null;
  }
  return options.multiple ? result.filePaths : (result.filePaths[0] ?? null);
});
ipcMain.handle("ttl:get-version", async () => app.getVersion());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", async (_event, argv) => {
    const installId = extractInstallId(argv);
    if (installId) {
      await triggerInstallLaunch(installId, { fromShortcut: true, hideWindow: true });
      return;
    }
    const win = getWindow();
    if (!win) {
      return;
    }
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
  });

  app.whenReady().then(async () => {
    ensureRuntimeDirs();
    createMainWindow();
    await startSidecar();
    await loadRenderer();
    createTray();
    if (pendingInstallLaunchId) {
      await triggerInstallLaunch(pendingInstallLaunchId, { fromShortcut: true, hideWindow: true });
    }
  }).catch((error) => {
    dialog.showErrorBox("Electron Bootstrap Failed", error instanceof Error ? error.message : String(error));
    app.quit();
  });
}

app.on("before-quit", async () => {
  isQuitting = true;
  await sidecar?.stop();
});

app.on("activate", () => {
  const win = getWindow();
  if (win) {
    win.show();
    win.focus();
    return;
  }
  createMainWindow();
  void loadRenderer();
});
