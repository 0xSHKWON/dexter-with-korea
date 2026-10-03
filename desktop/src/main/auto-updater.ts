/**
 * In-app auto-update via electron-updater (GitHub Releases feed).
 *
 * Windows only for now: NSIS auto-update works without code signing. macOS is
 * intentionally skipped — Squirrel.Mac requires a Developer ID signature to apply
 * an update, so until the app is signed+notarized mac keeps the manual update.json
 * prompt (see updater.ts). electron-builder already publishes latest.yml + blockmap,
 * which is exactly the feed electron-updater consumes.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import pkg from 'electron-updater';
import type { AutoUpdateStatus } from '../shared/types';

const { autoUpdater } = pkg;

// Startup check only would leave a long-running app blind to a release published
// after launch — users had to restart just to see the banner. Re-check when the
// user comes back to the app instead of on a timer, throttled.
const RECHECK_THROTTLE_MS = 5 * 60 * 1000;
let lastCheck = 0;

// Last pushed status, so a renderer that subscribes late (window still loading at
// startup, or a reload) can catch up instead of missing `update-downloaded`.
let lastStatus: AutoUpdateStatus | null = null;

export function getAutoUpdateStatus(): AutoUpdateStatus | null {
  return lastStatus;
}

function broadcast(status: AutoUpdateStatus): void {
  // download-progress carries no version; keep the one from update-available.
  if (status.state === 'downloading' && !status.version && lastStatus?.version) {
    status = { ...status, version: lastStatus.version };
  }
  lastStatus = status;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('update:status', status);
  }
}

function check(): void {
  lastCheck = Date.now();
  autoUpdater.checkForUpdates().catch(() => {
    /* offline / no feed — stay silent, app works normally */
  });
}

export function initAutoUpdater(): void {
  // electron-updater needs a packaged build with an embedded feed (app-update.yml).
  if (!app.isPackaged || process.platform !== 'win32') return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    broadcast({ state: 'downloading', version: info.version, percent: 0 }),
  );
  autoUpdater.on('update-not-available', () => broadcast({ state: 'none' }));
  autoUpdater.on('download-progress', (p) =>
    broadcast({ state: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ state: 'downloaded', version: info.version }),
  );
  autoUpdater.on('error', (err) =>
    broadcast({ state: 'error', message: err instanceof Error ? err.message : String(err) }),
  );

  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());

  check();
  app.on('browser-window-focus', () => {
    if (Date.now() - lastCheck < RECHECK_THROTTLE_MS) return;
    const busy = lastStatus?.state === 'checking' || lastStatus?.state === 'downloading';
    // Once downloaded there's nothing more to do until the user restarts.
    if (!busy && lastStatus?.state !== 'downloaded') check();
  });
}
