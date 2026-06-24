import { join } from 'node:path';
import { app, BrowserWindow, Menu, shell } from 'electron';
import { initDb } from './db';
import { registerIpc } from './ipc';
import { sidecar } from './sidecar';
import { initAutoUpdater } from './auto-updater';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Dexter',
    backgroundColor: '#0d1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  // Open external links in the OS browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // electron-vite injects ELECTRON_RENDERER_URL in dev (HMR server).
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  // Windows/Linux render the menu bar inside the window (File/Edit/View/Window),
  // which clutters the chat UI. macOS keeps it in the system menu bar, so leave it.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  initDb();
  registerIpc();
  createWindow();

  // Stream sidecar messages to all open renderer windows.
  sidecar.start((msg) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('chat:event', msg);
    }
  });

  // Windows in-app auto-update (no-op in dev / on macOS).
  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  sidecar.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => sidecar.stop());
