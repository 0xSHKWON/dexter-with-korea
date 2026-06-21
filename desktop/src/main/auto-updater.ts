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

function broadcast(status: AutoUpdateStatus): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:status', status);
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

  autoUpdater.checkForUpdates().catch(() => {
    /* offline / no feed — stay silent, app works normally */
  });
}
