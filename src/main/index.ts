import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OpenRgbClient } from './openrgb/client.js';
import { Engine } from './engine.js';
import { Store } from './store.js';
import { ServerManager } from './server.js';
import electronUpdater from 'electron-updater';
import { listConflicts, stopConflicts } from './conflicts.js';
import { autoLayout, reconcileLayout } from './autolayout.js';
import { findDirectMode } from './openrgb/protocol.js';
import type { DeviceSummary, EffectConfig, LayoutElement } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// electron-updater ships CommonJS, so it arrives as a default export under ESM.
const { autoUpdater } = electronUpdater;

/**
 * Updates.
 *
 * Only meaningful in a packaged build: a dev run has no update feed to ask.
 * Downloads happen in the background and install on quit, so a lighting session
 * is never interrupted by an installer window appearing over a game.
 */
function initUpdates() {
  if (!app.isPackaged) return;

  // Update failures are otherwise completely silent: electron-updater swallows
  // them into an event and deletes the partial download, so "checked, found
  // nothing" and "downloaded then rejected it" look identical from outside.
  // Cheap file log, no extra dependency.
  const logFile = path.join(app.getPath('userData'), 'updater.log');
  const write = (level: string, ...args: unknown[]) => {
    const line = `${new Date().toISOString()} [${level}] ${args.map(String).join(' ')}
`;
    try { fs.appendFileSync(logFile, line); } catch { /* logging must never break updating */ }
  };
  autoUpdater.logger = {
    info: (...a: unknown[]) => write('info', ...a),
    warn: (...a: unknown[]) => write('warn', ...a),
    error: (...a: unknown[]) => write('error', ...a),
    debug: (...a: unknown[]) => write('debug', ...a),
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (i) =>
    push('halo:notice', `Halo ${i.version} is available. Downloading in the background.`));
  autoUpdater.on('update-downloaded', (i) =>
    push('halo:notice', `Halo ${i.version} is ready and installs the next time you quit.`));
  autoUpdater.on('error', (e) =>
    push('halo:notice', `Could not check for updates: ${e?.message ?? e}`));

  void autoUpdater.checkForUpdates().catch(() => { /* surfaced by the error handler */ });
  // A rig that stays powered on for weeks should still pick updates up.
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: Store;
let client: OpenRgbClient;
let engine: Engine;
let server: ServerManager;
let quitting = false;

/* ------------------------------------------------------------------ */
/* window                                                              */
/* ------------------------------------------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#0B0B0C',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win?.show());

  // Closing the window minimises to tray. Lighting keeps running because the
  // engine lives in this process, not in the renderer.
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win?.hide(); }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../resources/tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Halo');

  const rebuild = () => {
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: win?.isVisible() ? 'Hide window' : 'Show window', click: () => (win?.isVisible() ? win.hide() : win?.show()) },
      { type: 'separator' },
      {
        label: engine.running ? 'Pause lighting' : 'Resume lighting',
        click: async () => {
          if (engine.running) { engine.stop(); engine.blackout(); }
          else await engine.start();
          rebuild();
        },
      },
      { type: 'separator' },
      { label: 'Quit Halo', click: () => { quitting = true; app.quit(); } },
    ]));
  };

  rebuild();
  tray.on('click', () => (win?.isVisible() ? win.hide() : win?.show()));
  engine.on('status', rebuild);
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function summarize(): DeviceSummary[] {
  return client.controllers.map((c) => {
    let offset = 0;
    const zones = c.zones.map((z, i) => {
      const entry = {
        index: i, name: z.name, ledCount: z.ledsCount, ledOffset: offset,
        ledsMin: z.ledsMin, ledsMax: z.ledsMax,
      };
      offset += z.ledsCount;
      return entry;
    });
    return {
      index: c.index,
      name: c.name,
      vendor: c.vendor || 'Unknown',
      type: c.typeName,
      ledCount: c.leds.length,
      zones,
      supportsDirect: findDirectMode(c) >= 0,
    };
  });
}

function push(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Load a saved layout, or seed one, then hand it to the engine. */
function applyLayout(elements?: LayoutElement[]) {
  let layout = elements;
  if (!layout) {
    const saved = store.layout;
    if (saved.length) {
      const { layout: merged, added, removed } = reconcileLayout(saved, client.controllers);
      layout = merged;
      if (added || removed) {
        push('halo:notice', `Hardware changed: ${added} zone(s) added, ${removed} removed. Placement kept for everything else.`);
      }
    } else {
      layout = autoLayout(client.controllers);
    }
  }
  store.setLayout(layout);
  engine.setLayout(layout);
  push('halo:layout', layout);
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

/** Everything about the hardware that would invalidate a layout. */
function hardwareSignature(): string {
  return client.controllers
    .map((c) => `${c.name}:${c.leds.length}:${c.zones.map((z) => z.ledsCount).join(',')}`)
    .join('|');
}

let lastHardwareSig = '';

async function boot() {
  store = new Store();
  server = new ServerManager();
  client = new OpenRgbClient('127.0.0.1', 6742, 'Halo');
  engine = new Engine(client, store.cfg);
  engine.setOverrides(store.overrides ?? {});

  client.on('state', (s) => push('halo:status', { ...engine.status(), state: s }));
  client.on('devices-changed', async () => {
    await client.refreshControllers();
    push('halo:devices', summarize());
    applyLayout();
  });
  client.on('controllers', () => {
    push('halo:devices', summarize());
    // A reconnect lands here too, not just first boot. Without this the app
    // reattaches to OpenRGB and then sits there not driving anything. Only
    // rebuild when the hardware actually differs, so the 15s poll below does
    // not rewrite the layout file forever.
    const sig = hardwareSignature();
    if (sig !== lastHardwareSig) {
      lastHardwareSig = sig;
      applyLayout();
    }
    if (!engine.running) void engine.start();
  });

  /**
   * OpenRGB only pushes DEVICE_LIST_UPDATED for hotplug, not for a zone being
   * resized by another client, and a zone resize changes LED counts without
   * changing the controller count. Polling the full list is the only reliable
   * way to notice, and at this interval it costs nothing.
   */
  setInterval(() => {
    if (!client.connected) return;
    void client.refreshControllers().catch(() => { /* retry loop owns recovery */ });
  }, 15000);

  engine.on('status', (s) => push('halo:status', s));
  engine.on('preview', ({ t, rgb }) => {
    // Copy, because the engine reuses this buffer every frame and the
    // structured clone happens asynchronously.
    push('halo:preview', { t, rgb: Buffer.from(rgb) });
  });

  createWindow();
  createTray();
  initUpdates();

  const started = await server.ensure(store.serverPath);
  if (!started.ok) {
    push('halo:notice', started.reason ?? 'Could not reach OpenRGB.');
    return;
  }

  try {
    await client.connectWithRetry();
    push('halo:devices', summarize());
    applyLayout();
    await engine.start();

    if (process.platform === 'win32' && client.controllers.every((c) => c.typeName !== 'Motherboard' && c.typeName !== 'DRAM')) {
      push('halo:notice', 'No motherboard or DRAM lighting was detected. On Windows those sit on the SMBus and need OpenRGB running as administrator.');
    }
  } catch (e) {
    push('halo:notice', e instanceof Error ? e.message : String(e));
  }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

ipcMain.handle('halo:getState', () => ({
  devices: summarize(),
  layout: store.layout,
  cfg: store.cfg,
  serverPath: store.serverPath,
  overrides: engine.overrides,
  profiles: store.profiles,
  status: engine.status(),
}));

ipcMain.handle('halo:setLayout', (_e, layout: LayoutElement[]) => {
  applyLayout(layout);
  return true;
});

ipcMain.handle('halo:setConfig', (_e, cfg: Partial<EffectConfig>) => {
  engine.setConfig(cfg);
  store.setCfg(engine.cfg);
  return engine.cfg;
});

ipcMain.handle('halo:autoLayout', () => {
  const fresh = autoLayout(client.controllers);
  applyLayout(fresh);
  return fresh;
});

ipcMain.handle('halo:setRunning', async (_e, run: boolean) => {
  if (run) await engine.start();
  else { engine.stop(); engine.blackout(); }
  return engine.running;
});

ipcMain.handle('halo:rescan', async () => {
  await client.refreshControllers();
  applyLayout();
  return summarize();
});

ipcMain.handle('halo:saveProfile', (_e, name: string) => {
  store.saveProfile(name, engine.cfg);
  return store.profiles;
});

ipcMain.handle('halo:loadProfile', (_e, name: string) => {
  const p = store.profiles.find((x) => x.name === name);
  if (!p) return null;
  engine.setConfig(p.cfg);
  store.setCfg(engine.cfg);
  return engine.cfg;
});

ipcMain.handle('halo:deleteProfile', (_e, name: string) => {
  store.deleteProfile(name);
  return store.profiles;
});

ipcMain.handle('halo:setServerPath', (_e, p: string | null) => {
  store.setServerPath(p);
  return true;
});

/* --- OpenRGB location ---------------------------------------------- */

ipcMain.handle('halo:pickServerPath', async () => {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Locate the OpenRGB executable',
    properties: ['openFile'],
    filters: process.platform === 'win32'
      ? [{ name: 'OpenRGB', extensions: ['exe'] }]
      : [],
  });
  if (res.canceled || !res.filePaths[0]) return store.serverPath;
  store.setServerPath(res.filePaths[0]);
  return res.filePaths[0];
});

ipcMain.handle('halo:clearServerPath', () => {
  store.setServerPath(null);
  return null;
});

/** Start OpenRGB if it is not already answering, then (re)connect. */
ipcMain.handle('halo:retryServer', async () => {
  const started = await server.ensure(store.serverPath);
  if (!started.ok) {
    push('halo:notice', started.reason ?? 'Could not reach OpenRGB.');
    return { ok: false as const, reason: started.reason };
  }
  try {
    await client.connectWithRetry();
    return { ok: true as const };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    push('halo:notice', reason);
    return { ok: false as const, reason };
  }
});

/* --- targeted overrides ------------------------------------------- */

ipcMain.handle('halo:setOverride', (_e, key: string, patch: Partial<EffectConfig> | null) => {
  const next = { ...engine.overrides };
  if (patch === null) delete next[key];
  else next[key] = { ...next[key], ...patch };
  engine.setOverrides(next);
  store.setOverrides(next);
  push('halo:overrides', next);
  return next;
});

ipcMain.handle('halo:clearOverrides', () => {
  engine.setOverrides({});
  store.setOverrides({});
  push('halo:overrides', {});
  return {};
});

/* --- conflicting RGB software -------------------------------------- */

ipcMain.handle('halo:listConflicts', () => listConflicts());

ipcMain.handle('halo:stopConflicts', async (_e, pids: number[]) => {
  const results = await stopConflicts(pids);
  const stopped = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  if (stopped && !failed.length) push('halo:notice', `Stopped ${stopped} conflicting process${stopped === 1 ? '' : 'es'}.`);
  else if (failed.length) push('halo:notice', `${stopped} stopped, ${failed.length} could not be: ${failed.map((f) => f.process).join(', ')}.`);
  return results;
});

/* --- addressable zone sizing --------------------------------------- */

ipcMain.handle('halo:resizeZone', async (_e, deviceIndex: number, zoneIndex: number, ledCount: number) => {
  try {
    await client.resizeZone(deviceIndex, zoneIndex, ledCount);
    // LED counts moved, so the saved layout no longer describes the hardware.
    applyLayout();
    push('halo:devices', summarize());
    return { ok: true as const };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    push('halo:notice', `Could not resize zone: ${reason}`);
    return { ok: false as const, reason };
  }
});

/* ------------------------------------------------------------------ */
/* app lifecycle                                                       */
/* ------------------------------------------------------------------ */

// A second instance would fight the first one for the SDK socket.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.whenReady().then(boot);
}

app.on('window-all-closed', () => { /* tray app: stay resident */ });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else win?.show();
});

app.on('before-quit', () => {
  quitting = true;
  engine?.stop();
  engine?.blackout();     // do not leave hardware frozen on the last frame
  store?.flush();
  client?.disconnect();
  server?.stop();
});
