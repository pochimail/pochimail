import { join } from "node:path";
import { createLogger } from "@pochimail/logger/logger";
import { t } from "@pochimail/ui/i18n/format.ts";
import { localeFromLanguages } from "@pochimail/ui/i18n/locale.ts";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MessageChannelMain,
  nativeImage,
  nativeTheme,
  safeStorage,
  session,
  shell,
  Tray,
  utilityProcess,
} from "electron";
import { demoScale, demoSwitches } from "../shared/demo.ts";
import { databasePathFor } from "./database-path.ts";
import { superviseModelHost } from "./model-host-supervisor.ts";
import { registerOsCalls } from "./os-calls.ts";
import { createSecretVault, type SecretVault } from "./secret-vault.ts";
import {
  hardenWebContents,
  isAppUrl,
  isRequestAllowed,
  sessionEgress,
  webPreferences,
} from "./security.ts";
import { smokeRuntimes } from "./smoke-runtimes.ts";
import { smokeStorage } from "./smoke-storage.ts";
import { registerStorageCalls } from "./storage-calls.ts";
import { createStorageGate, type StorageGate } from "./storage-gate.ts";
import { createAppTray } from "./tray.ts";
import { linkWorkerOnEveryLoad } from "./worker-link.ts";
import { bootWorker } from "./worker-start.ts";

// A packaged app never honours the dev-server variable, so an environment override cannot point the window elsewhere.
const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const devServerOrigin = devServerUrl === undefined ? undefined : new URL(devServerUrl).origin;
const rendererFile = join(import.meta.dirname, "../renderer/index.html");
// Dev only: a packaged app gets its icon from the installer (electron-builder, apps/desktop/build); `electron .` would show Electron's.
const devIconPath = app.isPackaged ? undefined : join(import.meta.dirname, "../../build/icon.png");

/** Session-wide guards: deny all permissions and cancel every request to a host that is not allowlisted. */
const lockDownSession = (): void => {
  const { defaultSession } = session;
  defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  defaultSession.setPermissionCheckHandler(() => false);
  defaultSession.setDevicePermissionHandler(() => false);
  defaultSession.webRequest.onBeforeRequest((details, callback) => {
    // Same shared policy as the worker client: static H1–H5 hosts and connected account hosts.
    const allowed = isRequestAllowed(details.url, {
      devServerOrigin,
      allowlist: sessionEgress.hosts(),
    });
    // Log the host only: never a full URL (privacy rules, AGENTS.md §5).
    if (!allowed)
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "request-blocked",
          host: new URL(details.url).host,
        }),
      );
    callback({ cancel: !allowed });
  });
};

// Redacted records only (core logger allow-list); structured JSON, same shape as the request-blocked warning.
const logger = createLogger({
  sink: {
    write: (record) =>
      console.warn(
        JSON.stringify({ level: record.level, message: record.message, ...record.fields }),
      ),
  },
});
// One vault per process: every window's worker shares its write queue, so concurrent updates never lose an entry.
let secretVault: SecretVault | undefined;
const processSecretVault = (): SecretVault => {
  secretVault ??= createSecretVault({
    vault: safeStorage,
    file: join(app.getPath("userData"), "secrets.json"),
    platform: process.platform,
    logger,
  });
  return secretVault;
};

// One gate per process: every window's worker waits on the same choice, and the person is asked at most once.
let storageGate: StorageGate | undefined;
const processStorageGate = (): StorageGate => {
  const userData = app.getPath("userData");
  storageGate ??= createStorageGate({
    vault: safeStorage,
    platform: process.platform,
    directory: userData,
    databaseFile: databasePathFor(userData),
    logger,
  });
  return storageGate;
};

// Demo mode (fixture mailbox, no real account) is for dev and E2E only: a packaged app never honours it.
const demo = app.isPackaged ? undefined : demoScale(process.env.POCHIMAIL_DEMO);
// Hosts get no copy of the parent environment: only what a process needs to start, plus the demo switch.
const SYSTEM_ENV = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "LANG",
  "LC_ALL",
] as const;
const demoEnv: Record<string, string> = {
  ...Object.fromEntries(
    SYSTEM_ENV.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value] as const];
    }),
  ),
  ...demoSwitches(demo, process.env),
};

// The worker alone gets the sign-in configuration; the database path travels in its start message.
const workerEnv = (): Record<string, string> => ({
  ...demoEnv,
  ...Object.fromEntries(
    ["POCHIMAIL_GOOGLE_CLIENT_ID", "POCHIMAIL_GOOGLE_CLIENT_SECRET"].flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value] as const];
    }),
  ),
});

const connectWorker = (window: BrowserWindow): void => {
  const worker = utilityProcess.fork(join(import.meta.dirname, "worker.js"), [], {
    serviceName: "pochimail-worker",
    env: workerEnv(),
  });
  // The model host is its own process so a model crash never takes the worker down; main restarts it.
  const modelHost = superviseModelHost({
    fork: () =>
      utilityProcess.fork(join(import.meta.dirname, "model-host.js"), [], {
        serviceName: "pochimail-model-host",
        env: demoEnv,
      }),
    worker,
    createChannel: () => new MessageChannelMain(),
    timer: {
      set: (fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      },
    },
    logger,
  });
  linkWorkerOnEveryLoad(window.webContents, worker, () => new MessageChannelMain());
  const userData = app.getPath("userData");
  const databasePath = databasePathFor(userData);
  void bootWorker({
    worker,
    secrets: processSecretVault(),
    databasePath,
    loadKey: () => processStorageGate().key(),
    createChannel: () => new MessageChannelMain(),
    // Sign-in consent opens in the user's browser, never in an app window (ADR 0007).
    openExternal: (url) => shell.openExternal(url),
    logger,
  });
  window.once("closed", () => {
    modelHost.stop();
    worker.kill();
  });
};

const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    show: false,
    ...(devIconPath !== undefined && process.platform !== "darwin" ? { icon: devIconPath } : {}),
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    webPreferences: {
      ...webPreferences,
      preload: join(import.meta.dirname, "../preload/index.cjs"),
    },
  });
  window.once("ready-to-show", () => window.show());
  connectWorker(window);
  // Packaging smoke test (M0-10): report that the renderer loaded, then quit.
  if (process.env.POCHIMAIL_SMOKE === "1")
    window.webContents.once("did-finish-load", () => {
      process.stdout.write("smoke:window-loaded\n");
      void smokeStorage({
        vault: safeStorage,
        fork: () =>
          utilityProcess.fork(join(import.meta.dirname, "storage-smoke.js"), [], {
            serviceName: "pochimail-storage-smoke",
          }),
      })
        .then(() =>
          smokeRuntimes(() =>
            utilityProcess.fork(join(import.meta.dirname, "runtime-smoke.js"), [], {
              serviceName: "pochimail-runtime-smoke",
            }),
          ),
        )
        .finally(() => app.quit());
    });
  if (devServerUrl === undefined) void window.loadFile(rendererFile);
  else void window.loadURL(devServerUrl);
};

app.on("web-contents-created", (_event, contents) =>
  hardenWebContents(contents, (url) => isAppUrl(url, { devServerOrigin, rendererFile })),
);

void app.whenReady().then(() => {
  nativeTheme.themeSource = "system";
  if (devIconPath !== undefined && process.platform === "darwin")
    app.dock?.setIcon(nativeImage.createFromPath(devIconPath));
  lockDownSession();
  registerOsCalls({
    ipc: ipcMain,
    openExternal: (url) => shell.openExternal(url),
    showItemInFolder: (path) => shell.showItemInFolder(path),
    chooseFolder: async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    isAppUrl: (url) => isAppUrl(url, { devServerOrigin, rendererFile }),
    appDataDirs: () => [app.getPath("userData")],
  });
  registerStorageCalls({
    ipc: ipcMain,
    gate: processStorageGate(),
    isAppUrl: (url) => isAppUrl(url, { devServerOrigin, rendererFile }),
  });
  createWindow();
  const locale = localeFromLanguages(app.getPreferredSystemLanguages());
  // Packaged: the images ship as extra resources next to app.asar (electron-builder.config.ts).
  const trayImages = app.isPackaged
    ? join(process.resourcesPath, "tray")
    : join(import.meta.dirname, "../../resources/tray");
  const appTray = createAppTray({
    platform: process.platform,
    imagesDir: trayImages,
    theme: nativeTheme,
    createTray: (image) => new Tray(image),
    imageFromPath: (path, template) => {
      const image = nativeImage.createFromPath(path);
      image.setTemplateImage(template);
      return image;
    },
    buildMenu: (items) => Menu.buildFromTemplate([...items]),
    labels: {
      tooltip: t("nav.brand", undefined, { locale }),
      open: t("tray.open", undefined, { locale }),
      quit: t("tray.quit", undefined, { locale }),
    },
    openApp: () => {
      const [window] = BrowserWindow.getAllWindows();
      if (window === undefined) createWindow();
      else {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      }
    },
    quit: () => app.quit(),
  });
  app.on("will-quit", appTray.dispose);
  app.on("will-quit", () => processStorageGate().dispose());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
