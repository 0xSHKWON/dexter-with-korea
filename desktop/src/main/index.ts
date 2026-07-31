import { join } from 'node:path';
import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
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

  // better-sqlite3 is a native module and the DB file is user data: an ABI
  // mismatch after an update, a corrupt file, or a locked WAL all throw here.
  // Unhandled, that killed startup before createWindow() — the app "opened" to
  // nothing at all, with no window and no error the user could reach.
  try {
    initDb();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      'Dexter를 시작할 수 없습니다',
      `설정 데이터베이스를 열지 못했습니다.\n\n${detail}\n\n` +
        `앱을 다시 설치하거나, 아래 폴더의 dexter-desktop.db 파일을 옮긴 뒤 다시 실행해 주세요. ` +
        `(대화 기록은 그 파일에 저장되어 있으니 지우지 말고 보관하세요.)\n\n${app.getPath('userData')}`,
    );
    app.quit();
    return;
  }

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
