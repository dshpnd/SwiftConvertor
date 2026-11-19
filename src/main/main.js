const {
  app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, screen, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
  formats, getCategory, getOutputs, getOutputsForMany, normalizeExtension,
} = require('../converters/formats');
const { convertImage } = require('../converters/image');
const { MISSING_FFMPEG_MESSAGE, killActiveProcesses } = require('../converters/ffmpeg');
const {
  MISSING_PANDOC_MESSAGE, convertDocument, killActiveProcesses: killPandocProcesses,
} = require('../converters/document');
const { convertDocumentToPdf } = require('../converters/documentPdf');
const {
  MISSING_POPPLER_MESSAGE, pdfToText, pdfToImages,
} = require('../converters/pdfTools');
const {
  getQuality, setQuality, getShortcut, setShortcut,
} = require('./settings');

const IDLE_SIZE = 140;
const EXPANDED_SIZE = 440;
const execFileAsync = promisify(execFile);
const selfTestMode = process.argv.includes('--self-test');
const gotSingleInstanceLock = selfTestMode ? true : app.requestSingleInstanceLock();
app.setAppUserModelId('com.swiftconvertor.app');
let mainWindow;
let launchQueue = [];
let launchQueueTimer = null;

if (selfTestMode) {
  app.on('before-quit', () => {
    killActiveProcesses();
    killPandocProcesses();
  });
} else if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    console.log('second-instance paths:', JSON.stringify(commandLine));
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    queueLaunchFiles(commandLine);
  });
}

function setWindowSize(win, size) {
  const bounds = win.getBounds();
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const maxX = workArea.x + Math.max(0, workArea.width - size);
  const maxY = workArea.y + Math.max(0, workArea.height - size);
  win.setBounds({
    x: Math.max(workArea.x, Math.min(maxX, Math.round(centerX - size / 2))),
    y: Math.max(workArea.y, Math.min(maxY, Math.round(centerY - size / 2))),
    width: size,
    height: size,
  }, false);
  logWindowMetrics(win, `resize ${size}`);
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;

  const win = new BrowserWindow({
    width: IDLE_SIZE,
    height: IDLE_SIZE,
    x: Math.round(workArea.x + (workArea.width - IDLE_SIZE) / 2),
    y: Math.round(workArea.y + (workArea.height - IDLE_SIZE) / 2),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', '..', 'build', 'icon.png'),
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
  logWindowMetrics(win, 'startup');
  return win;
}

Menu.setApplicationMenu(null);

const shortcutOptions = ['Ctrl+Alt+C', 'Ctrl+Alt+S', 'Ctrl+Alt+Space', 'Off'];
const shortcutErrorMessage = 'That shortcut is used by another app';

function getLaunchCommand() {
  return app.isPackaged
    ? { target: process.execPath, args: [] }
    : { target: process.execPath, args: [app.getAppPath()] };
}

function quoteWindowsArgument(value) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function sanitizeIncomingFiles(paths) {
  const seen = new Set();
  const files = [];
  for (const filePath of paths) {
    if (typeof filePath !== 'string' || filePath.startsWith('-')) continue;
    const resolved = path.resolve(filePath);
    if (resolved === path.resolve(app.getAppPath())) continue;
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    try {
      if (!fs.statSync(resolved).isFile()) continue;
    } catch {
      continue;
    }
    seen.add(key);
    files.push(resolved);
    if (files.length === 200) break;
  }
  return files;
}

function queueLaunchFiles(commandLine) {
  console.log('launch paths received:', JSON.stringify(commandLine));
  const files = sanitizeIncomingFiles(commandLine.slice(1));
  if (!files.length) return;
  launchQueue = sanitizeIncomingFiles([...launchQueue, ...files]);
  if (launchQueueTimer) return;
  launchQueueTimer = setTimeout(() => {
    launchQueueTimer = null;
    const queuedFiles = launchQueue;
    launchQueue = [];
    console.log('launch aggregation complete:', queuedFiles.length);
    openWheelWithFiles(queuedFiles);
  }, 500);
}

function getInputExtensions() {
  return [...new Set(Object.values(formats).flat())];
}

function sendToShortcutPath() {
  return path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'SendTo', 'SwiftConvertor.lnk');
}

function isSendToEnabled() {
  return fs.existsSync(sendToShortcutPath());
}

function setSendToIntegration(enabled) {
  const shortcutPath = sendToShortcutPath();
  if (!process.env.APPDATA) throw new Error('APPDATA is not available');
  if (!enabled) {
    if (fs.existsSync(shortcutPath)) fs.unlinkSync(shortcutPath);
    return;
  }
  const command = getLaunchCommand();
  const args = [...command.args, '%1'].map(quoteWindowsArgument).join(' ');
  const written = shell.writeShortcutLink(shortcutPath, 'create', {
    target: command.target,
    args,
    description: 'Convert with SwiftConvertor',
    icon: command.target,
    iconIndex: 0,
  });
  if (!written) throw new Error('Windows could not create the Send To shortcut.');
}

function explorerKey(extension) {
  return `HKCU\\Software\\Classes\\SystemFileAssociations\\.${extension}\\shell\\SwiftConvertor`;
}

async function runRegistry(args) {
  await execFileAsync('reg.exe', args, { windowsHide: true, shell: false });
}

async function setExplorerIntegration(enabled) {
  const command = getLaunchCommand();
  const launch = [command.target, ...command.args].map(quoteWindowsArgument).join(' ');
  for (const extension of getInputExtensions()) {
    const key = explorerKey(extension);
    if (!enabled) {
      await runRegistry(['delete', key, '/f']);
      continue;
    }
    await runRegistry(['add', key, '/ve', '/d', 'Convert with SwiftConvertor', '/f']);
    await runRegistry(['add', key, '/v', 'Icon', '/d', command.target, '/f']);
    await runRegistry(['add', `${key}\\command`, '/ve', '/d', `${launch} "%1"`, '/f']);
  }
}

async function isExplorerIntegrationEnabled() {
  try {
    await runRegistry(['query', explorerKey(getInputExtensions()[0])]);
    return true;
  } catch {
    return false;
  }
}

async function updateIntegration(kind, enabled, event) {
  try {
    if (kind === 'send-to') setSendToIntegration(enabled);
    else await setExplorerIntegration(enabled);
    const message = 'Done';
    console.log(`${kind} integration ${enabled ? 'enabled' : 'disabled'}`);
    event.sender.send('integration:message', message);
  } catch (error) {
    const message = `Could not update ${kind === 'send-to' ? 'Send To' : 'Explorer'} integration: ${error.message}`;
    console.error(message);
    event.sender.send('integration:message', message);
  }
}

function sendToRenderer(channel, value) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => mainWindow.webContents.send(channel, value));
  } else {
    mainWindow.webContents.send(channel, value);
  }
}

function openWheelWithFiles(filePaths) {
  console.log('opening files:', filePaths.length);
  sendToRenderer('files:open', filePaths);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();
}

function readExplorerSelection() {
  const command = "$sig='[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();'; Add-Type -MemberDefinition $sig -Name Win -Namespace Native; $h=[Native.Win]::GetForegroundWindow().ToInt64(); foreach($w in (New-Object -ComObject Shell.Application).Windows()){ if($w.HWND -eq $h){ foreach($i in $w.Document.SelectedItems()){ $i.Path } } }";
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', command,
    ], { windowsHide: true, timeout: 2000, shell: false }, (error, stdout) => {
      if (error) {
        console.log('Explorer selection failed:', error.killed ? 'timeout' : error.message);
        resolve([]);
        return;
      }
      const selected = stdout.split(/\r?\n/)
        .map((filePath) => filePath.trim())
        .filter((filePath) => {
          try {
            return filePath && fs.statSync(filePath).isFile();
          } catch {
            return false;
          }
        })
        .slice(0, 200);
      console.log('Explorer selection read:', selected.length);
      resolve(selected);
    });
  });
}

async function selectFilesForShortcut() {
  const explorerFiles = await readExplorerSelection();
  if (explorerFiles.length) {
    console.log('shortcut file source: Explorer');
    return explorerFiles;
  }

  console.log('shortcut file source: open dialog');
  const extensions = [...new Set(Object.values(formats).flat())].map((extension) => `.${extension}`);
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Supported files', extensions: extensions.map((extension) => extension.slice(1)) }],
  });
  const selected = result.canceled ? [] : result.filePaths.slice(0, 200);
  console.log('open dialog result:', result.canceled ? 'canceled' : `${selected.length} files`);
  return selected;
}

function registerShortcut(shortcut) {
  globalShortcut.unregisterAll();
  if (shortcut === 'Off') {
    console.log('keyboard shortcut: Off');
    return true;
  }
  const registered = globalShortcut.register(shortcut, async () => {
    console.log('keyboard shortcut fired:', shortcut);
    const filePaths = await selectFilesForShortcut();
    if (filePaths.length) openWheelWithFiles(filePaths);
  });
  console.log('keyboard shortcut registration:', shortcut, registered ? 'success' : 'failed');
  if (!registered) {
    setShortcut('Off');
    sendToRenderer('shortcut:error', shortcutErrorMessage);
  }
  return registered;
}

function setKeyboardShortcut(shortcut) {
  const nextShortcut = shortcutOptions.includes(shortcut) ? shortcut : 'Off';
  const registered = registerShortcut(nextShortcut);
  const savedShortcut = registered ? nextShortcut : 'Off';
  setShortcut(savedShortcut);
  console.log('keyboard shortcut changed:', savedShortcut);
  return savedShortcut;
}

app.whenReady().then(() => {
  if (selfTestMode) {
    console.log('self-test argv:', JSON.stringify(process.argv));
    new BrowserWindow({ show: false });
    require('./selfTest').run().then((passed) => app.exit(passed ? 0 : 1)).catch((error) => {
      console.error(error);
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const explicitIndex = process.argv.indexOf('--out');
      const reportPath = explicitIndex >= 0 && process.argv[explicitIndex + 1]
        ? process.argv[explicitIndex + 1]
        : path.join(os.tmpdir(), 'swiftconvertor-selftest.json');
      try {
        fs.writeFileSync(reportPath, JSON.stringify({
          passed: false,
          report: [{ test: 'Self-test runner', pass: false, error: error.message, binaryPath: '' }],
        }, null, 2));
      } catch {}
      app.exit(1);
    });
    return;
  }
  if (!gotSingleInstanceLock) return;
  mainWindow = createWindow();
  registerShortcut(getShortcut());
  queueLaunchFiles(process.argv);
});

function logWindowMetrics(win, label) {
  console.log(`window metrics ${label}:`, JSON.stringify({
    bounds: win.getBounds(),
    contentBounds: win.getContentBounds(),
    minimumSize: win.getMinimumSize(),
    maximumSize: win.getMaximumSize(),
    resizable: win.isResizable(),
  }));
}

ipcMain.handle('expand-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) setWindowSize(mainWindow, EXPANDED_SIZE);
});
ipcMain.handle('collapse-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) setWindowSize(mainWindow, IDLE_SIZE);
});

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

ipcMain.handle('get-outputs-for-many', (_event, category, extensions) => {
  requireString(category, 'category');
  if (!Object.prototype.hasOwnProperty.call(formats, category)) {
    throw new Error('Invalid category');
  }
  if (!Array.isArray(extensions) || extensions.some((extension) => typeof extension !== 'string')) {
    throw new Error('Invalid extensions');
  }
  return getOutputsForMany(category, extensions);
});

ipcMain.handle('get-files-info', (_event, filePaths) => {
  if (!Array.isArray(filePaths) || filePaths.some((filePath) => typeof filePath !== 'string')) {
    throw new Error('Invalid file paths');
  }
  return filePaths.map((filePath) => ({
    name: path.basename(filePath),
    extension: normalizeExtension(path.extname(filePath).slice(1)),
    category: getCategory(filePath),
  }));
});

ipcMain.handle('get-quality', () => getQuality());

ipcMain.handle('show-context-menu', async (event) => {
  const currentQuality = getQuality();
  const currentShortcut = getShortcut();
  const sendToEnabled = isSendToEnabled();
  const explorerEnabled = await isExplorerIntegrationEnabled();
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
    {
      label: 'Keyboard shortcut',
      submenu: shortcutOptions.map((shortcut) => ({
        label: shortcut,
        type: 'radio',
        checked: shortcut === currentShortcut,
        click: () => {
          const nextShortcut = setKeyboardShortcut(shortcut);
          event.sender.send('settings:shortcut', nextShortcut);
        },
      })),
    },
    {
      label: 'Add to Send To',
      type: 'checkbox',
      checked: sendToEnabled,
      click: (menuItem) => updateIntegration('send-to', menuItem.checked, event),
    },
    {
      label: 'Add to Explorer right-click menu',
      type: 'checkbox',
      checked: explorerEnabled,
      click: (menuItem) => updateIntegration('explorer', menuItem.checked, event),
    },
    { type: 'separator' },
    { label: 'Quit SwiftConvertor', click: () => app.quit() },
  ]);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

ipcMain.handle('show-in-folder', (_event, filePath) => {
  requireString(filePath, 'file path');
  if (!fs.existsSync(filePath)) {
    throw new Error('File does not exist');
  }
  if (fs.statSync(filePath).isDirectory()) {
    shell.openPath(filePath);
  } else {
    shell.showItemInFolder(filePath);
  }
});

ipcMain.handle('convert:run', async (_event, filePath, targetExt) => {
  try {
    requireString(filePath, 'file path');
    requireString(targetExt, 'target extension');

    const fileStats = await fs.promises.stat(filePath);
    const sourceExt = normalizeExtension(path.extname(filePath).slice(1));
    const target = normalizeExtension(targetExt);
    const category = getCategory(filePath);
    if (!fileStats.isFile()
      || !['image', 'document', 'pdf'].includes(category)) {
      throw new Error('Invalid conversion request');
    }

    if (sourceExt === target) {
      return { ok: true, skipped: true };
    }
    if (!getOutputs(category, sourceExt).includes(target)) {
      throw new Error('Invalid conversion request');
    }

    if (category === 'pdf') {
      const result = target === 'txt'
        ? await pdfToText(filePath)
        : await pdfToImages(filePath, target);
      return typeof result === 'string'
        ? { ok: true, outputPath: result }
        : { ok: true, ...result };
    }
    const outputPath = category === 'document'
      ? target === 'pdf'
        ? await convertDocumentToPdf(filePath)
        : await convertDocument(filePath, target)
      : await convertImage(filePath, target, getQuality());
    return { ok: true, outputPath };
  } catch (error) {
    console.error('Conversion failed:', error);
    return {
      ok: false,
      error: error.message === MISSING_FFMPEG_MESSAGE
        ? MISSING_FFMPEG_MESSAGE
        : error.message === MISSING_PANDOC_MESSAGE
          ? MISSING_PANDOC_MESSAGE
          : error.message === MISSING_POPPLER_MESSAGE
            ? MISSING_POPPLER_MESSAGE
        : category === 'document' && target === 'pdf'
          ? 'Could not create the PDF. The document may be damaged.'
          : 'Could not convert this file. It may be damaged or not a real image.',
    };
  }
});

if (!selfTestMode) {
  app.on('window-all-closed', () => {
    app.quit();
  });
}

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  killActiveProcesses();
  killPandocProcesses();
});
