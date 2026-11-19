const { app, BrowserWindow, ipcMain, Menu, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  getCategory, getOutputs, getOutputsForMany, normalizeExtension,
} = require('../converters/formats');
const { convertImage } = require('../converters/image');
const { MISSING_FFMPEG_MESSAGE } = require('../converters/ffmpeg');
const { getQuality, setQuality } = require('./settings');

const WINDOW_SIZE = 140;
const ACTIVE_WINDOW_SIZE = 440;

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;

  const win = new BrowserWindow({
    width: WINDOW_SIZE,
    height: WINDOW_SIZE,
    useContentSize: true,
    x: Math.round(workArea.x + (workArea.width - WINDOW_SIZE) / 2),
    y: Math.round(workArea.y + (workArea.height - WINDOW_SIZE) / 2),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenu(null);
  win.webContents.on('console-message', (details) => {
    console.log(`[renderer] ${details.message}`);
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  console.log('window bounds at startup:', win.getBounds(), 'content size:', win.getContentSize());
  return win;
}

Menu.setApplicationMenu(null);

let mainWindow;

app.whenReady().then(() => {
  mainWindow = createWindow();
});

function resizeWindow(size) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const bounds = mainWindow.getBounds();
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const maxX = workArea.x + Math.max(0, workArea.width - size);
  const maxY = workArea.y + Math.max(0, workArea.height - size);
  mainWindow.setBounds({
    x: Math.max(workArea.x, Math.min(maxX, Math.round(centerX - size / 2))),
    y: Math.max(workArea.y, Math.min(maxY, Math.round(centerY - size / 2))),
    width: size,
    height: size,
  }, false);
  console.log('window bounds after resize:', mainWindow.getBounds(), 'content size:', mainWindow.getContentSize());
}

ipcMain.handle('expand-window', () => resizeWindow(ACTIVE_WINDOW_SIZE));
ipcMain.handle('collapse-window', () => resizeWindow(WINDOW_SIZE));

ipcMain.handle('get-file-info', (_event, filePath) => {
  return {
    name: path.basename(filePath),
    extension: normalizeExtension(path.extname(filePath).slice(1)),
    category: getCategory(filePath),
  };
});

ipcMain.handle('get-outputs', (_event, category, sourceExt) => getOutputs(category, sourceExt));
ipcMain.handle('get-outputs-for-many', (_event, category, extensions) => (
  Array.isArray(extensions) ? getOutputsForMany(category, extensions) : []
));

ipcMain.handle('get-files-info', (_event, filePaths) => {
  if (!Array.isArray(filePaths)) {
    return [];
  }
  return filePaths.map((filePath) => ({
    name: path.basename(filePath),
    extension: normalizeExtension(path.extname(filePath).slice(1)),
    category: getCategory(filePath),
  }));
});

ipcMain.handle('get-quality', () => getQuality());

ipcMain.handle('show-context-menu', (event) => {
  const currentQuality = getQuality();
  const menu = Menu.buildFromTemplate([
    { label: 'Quality', enabled: false },
    ...['small', 'balanced', 'best'].map((quality) => ({
      label: quality[0].toUpperCase() + quality.slice(1),
      type: 'radio',
      checked: quality === currentQuality,
      click: () => {
        const nextQuality = setQuality(quality);
        event.sender.send('settings:quality', nextQuality);
        console.log('quality changed:', nextQuality);
      },
    })),
    { type: 'separator' },
    { label: 'Quit SwiftConvertor', click: () => app.quit() },
  ]);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

ipcMain.handle('show-in-folder', (_event, filePath) => {
  if (typeof filePath !== 'string' || !fs.existsSync(filePath)) {
    throw new Error('File does not exist');
  }
  shell.showItemInFolder(filePath);
});

ipcMain.handle('convert:run', async (_event, filePath, targetExt) => {
  try {
    if (typeof filePath !== 'string' || typeof targetExt !== 'string') {
      throw new Error('Invalid conversion request');
    }

    const fileStats = await fs.promises.stat(filePath);
    const sourceExt = normalizeExtension(path.extname(filePath).slice(1));
    const target = normalizeExtension(targetExt);
    if (!fileStats.isFile()
      || getCategory(filePath) !== 'image') {
      throw new Error('Invalid conversion request');
    }

    if (sourceExt === target) {
      return { ok: true, skipped: true };
    }
    if (!getOutputs('image', sourceExt).includes(target)) {
      throw new Error('Invalid conversion request');
    }

    const outputPath = await convertImage(filePath, target, getQuality());
    return { ok: true, outputPath };
  } catch (error) {
    console.error('Image conversion failed:', error);
    return {
      ok: false,
      error: error.message === MISSING_FFMPEG_MESSAGE
        ? MISSING_FFMPEG_MESSAGE
        : 'Could not convert this file. It may be damaged or not a real image.',
    };
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
