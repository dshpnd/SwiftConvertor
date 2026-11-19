const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { spawn } = require('child_process');
const { getUniqueOutputPath } = require('./naming');
const { getQuality } = require('../main/settings');

const MISSING_POPPLER_MESSAGE = 'Poppler is missing. Put the poppler folder in the bin folder.';

function getPopplerPath(exeName) {
  const directory = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'poppler')
    : path.join(__dirname, '..', '..', 'bin', 'poppler');
  const executable = path.join(directory, exeName);
  if (!fs.existsSync(executable)) throw new Error(MISSING_POPPLER_MESSAGE);
  return executable;
}

function plainPdfError(stderr) {
  const text = String(stderr || '');
  if (/password|Incorrect password/i.test(text)) {
    return 'This PDF is password-protected.';
  }
  return 'Could not read this PDF. It may be damaged.';
}

function runPoppler(exe, args, { timeoutMs = 300000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    let executable;
    try {
      executable = getPopplerPath(exe);
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(executable, args, { windowsHide: true, shell: false, cwd });
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(error.message || plainPdfError(stderr)));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(plainPdfError(stderr)));
      }
    });
  });
}

async function pdfToText(inputPath) {
  const outputPath = getUniqueOutputPath(inputPath, 'txt');
  try {
    await runPoppler('pdftotext.exe', ['-enc', 'UTF-8', inputPath, outputPath]);
    const text = await fs.promises.readFile(outputPath, 'utf8');
    if (!text.replace(/[\s\f]/g, '').length) {
      await fs.promises.unlink(outputPath).catch(() => {});
      throw new Error('No text found in this PDF. It may be a scanned document.');
    }
    return outputPath;
  } catch (error) {
    await fs.promises.unlink(outputPath).catch(() => {});
    throw error;
  }
}

function uniqueFolder(inputPath, format) {
  const directory = path.dirname(inputPath);
  const name = path.basename(inputPath, path.extname(inputPath));
  const base = path.join(directory, `${name}(${format})`);
  let folder = base;
  let counter = 1;
  while (fs.existsSync(folder)) {
    counter += 1;
    folder = `${base} (${counter})`;
  }
  fs.mkdirSync(folder);
  return folder;
}

async function pdfToImages(inputPath, format) {
  const normalized = format === 'jpg' ? 'jpg' : 'png';
  const folder = uniqueFolder(inputPath, normalized);
  try {
    const quality = getQuality();
    const dpi = quality === 'small' ? 100 : quality === 'best' ? 300 : 150;
    const args = ['-r', String(dpi)];
    if (normalized === 'png') {
      args.push('-png');
    } else {
      args.push('-jpeg', '-jpegopt', `quality=${quality === 'small' ? 70 : quality === 'best' ? 95 : 85}`);
    }
    args.push(inputPath, 'page');
    await runPoppler('pdftoppm.exe', args, { timeoutMs: 300000, cwd: folder });

    const prefixFiles = (await fs.promises.readdir(folder))
      .filter((name) => /^page-\d+\.(png|jpg|jpeg)$/i.test(name))
      .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
    if (!prefixFiles.length) throw new Error('Could not read this PDF. It may be damaged.');

    const width = Math.max(2, String(prefixFiles.length).length);
    for (let index = 0; index < prefixFiles.length; index += 1) {
      const oldPath = path.join(folder, prefixFiles[index]);
      const number = String(index + 1).padStart(width, '0');
      await fs.promises.rename(oldPath, path.join(folder, `page-${number}.${normalized}`));
    }
    return { outputPath: folder, pages: prefixFiles.length };
  } catch (error) {
    await fs.promises.rm(folder, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  MISSING_POPPLER_MESSAGE,
  getPopplerPath,
  runPoppler,
  pdfToText,
  pdfToImages,
};
