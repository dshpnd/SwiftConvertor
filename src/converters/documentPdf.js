const fs = require('fs');
const fsPromises = fs.promises;
const os = require('os');
const path = require('path');
const { BrowserWindow, session } = require('electron');
const { getUniqueOutputPath } = require('./naming');
const { readTextFile } = require('./textFile');
const { runPandoc } = require('./document');
const { printStyles, plainTextStyles } = require('./printStyles');

const PDF_ERROR = 'Could not create the PDF. The document may be damaged.';
const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src data:">';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function writeHeader(filePath) {
  await fsPromises.writeFile(filePath, `${CSP}<style>${printStyles}</style>`, 'utf8');
}

async function writeTextHtml(filePath, text) {
  await fsPromises.writeFile(filePath, `<!doctype html><html><head>${CSP}<style>${plainTextStyles}</style></head><body><pre>${escapeHtml(text)}</pre></body></html>`, 'utf8');
}

function printWindow(tempHtml) {
  const partition = `persist:swiftconvertor-print-${process.pid}-${Date.now()}`;
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition,
    },
  });
  const printSession = session.fromPartition(partition);
  printSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    callback({ cancel: !details.url.startsWith('data:') && !details.url.startsWith('file:') });
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  return win.loadFile(tempHtml)
    .then(() => win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.8, bottom: 0.9, left: 0.8, right: 0.8 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#777"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    }))
    .finally(() => win.destroy());
}

async function convertDocumentToPdf(inputPath) {
  const outputPath = getUniqueOutputPath(inputPath, 'pdf');
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'swiftconvertor-pdf-'));
  const htmlPath = path.join(tempDir, 'document.html');
  const headerPath = path.join(tempDir, 'header.html');
  const sourceExt = path.extname(inputPath).slice(1).toLowerCase();
  let outputBuffer;

  try {
    if (sourceExt === 'txt') {
      await writeTextHtml(htmlPath, await readTextFile(inputPath));
    } else {
      await writeHeader(headerPath);
      const reader = sourceExt === 'docx' ? 'docx' : 'gfm';
      const mediaPath = path.join(tempDir, 'media');
      const pandocArgs = [
        inputPath, '-f', reader, '-t', 'html5', '--standalone', '--embed-resources',
        '--resource-path=.', `--metadata`, `pagetitle=${path.basename(inputPath, path.extname(inputPath))}`,
        `--extract-media=${mediaPath}`, '--include-in-header', headerPath, '-o', htmlPath,
      ];
      try {
        await runPandoc(pandocArgs, path.dirname(inputPath));
      } catch (error) {
        if (!/embed-resources|unknown option/i.test(error.message)) throw error;
        const fallbackArgs = pandocArgs.map((arg) => arg === '--embed-resources' ? '--self-contained' : arg);
        await runPandoc(fallbackArgs, path.dirname(inputPath));
      }
    }

    outputBuffer = await Promise.race([
      printWindow(htmlPath),
      new Promise((_, reject) => setTimeout(() => reject(new Error(PDF_ERROR)), 90000)),
    ]);
    await fsPromises.writeFile(outputPath, outputBuffer, { flag: 'wx' });
    return outputPath;
  } catch (error) {
    try {
      await fsPromises.unlink(outputPath);
    } catch (unlinkError) {
      if (unlinkError.code !== 'ENOENT') console.error('Could not remove partial PDF:', unlinkError);
    }
    if (error.message === PDF_ERROR) throw error;
    throw new Error(PDF_ERROR);
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = { convertDocumentToPdf };
