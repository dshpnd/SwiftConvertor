const fs = require('fs');
const fsPromises = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { getBinaryPath } = require('./ffmpeg');
const { getUniqueOutputPath } = require('./naming');
const { readTextFile } = require('./textFile');

const MISSING_PANDOC_MESSAGE = 'Pandoc is missing. Put pandoc.exe in the bin folder.';
const activeProcesses = new Set();

function runPandoc(args, cwd) {
  let child;
  try {
    child = spawn(
      getBinaryPath('pandoc.exe', MISSING_PANDOC_MESSAGE),
      args,
      { windowsHide: true, cwd, shell: false },
    );
    activeProcesses.add(child);
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Pandoc timed out after 120 seconds.'));
    }, 120000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      activeProcesses.delete(child);
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      activeProcesses.delete(child);
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      const lines = stderr.trim().split(/\r?\n/).filter(Boolean);
      reject(new Error(lines.slice(-10).join('\n') || `Pandoc exited with code ${code}`));
    });
  });
}

function killActiveProcesses() {
  for (const child of activeProcesses) {
    if (!child.killed) child.kill();
  }
  activeProcesses.clear();
}

async function removeOutput(outputPath) {
  try {
    await fsPromises.unlink(outputPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function removeEmptyMediaFolder(folderPath) {
  try {
    const entries = await fsPromises.readdir(folderPath);
    if (!entries.length) await fsPromises.rmdir(folderPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function convertDocument(inputPath, targetExt) {
  const sourceExt = path.extname(inputPath).slice(1).toLowerCase() === 'markdown'
    ? 'md'
    : path.extname(inputPath).slice(1).toLowerCase();
  const target = targetExt.toLowerCase() === 'markdown' ? 'md' : targetExt.toLowerCase();
  const outputPath = getUniqueOutputPath(inputPath, target);
  const cwd = path.dirname(inputPath);
  let pandocInput = inputPath;
  let temporaryInput = null;
  let mediaFolder = null;

  try {
    if (sourceExt === 'txt') {
      temporaryInput = path.join(
        os.tmpdir(),
        `swiftconvertor-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.md`,
      );
      await fsPromises.writeFile(temporaryInput, await readTextFile(inputPath), 'utf8');
      pandocInput = temporaryInput;
    }

    const reader = sourceExt === 'docx' ? 'docx' : sourceExt === 'txt' ? 'markdown+hard_line_breaks' : 'gfm';
    const writer = target === 'docx' ? 'docx' : target === 'txt' ? 'plain' : 'gfm';
    const args = [pandocInput, '-f', reader, '-t', writer];
    if (target === 'md') {
      args.push('--wrap=none');
      if (sourceExt === 'docx') {
        mediaFolder = path.basename(outputPath, path.extname(outputPath)) + '_media';
        args.push(`--extract-media=${mediaFolder}`);
      }
    } else if (target === 'txt') {
      args.push('--wrap=none');
    }
    args.push('-o', outputPath);
    await runPandoc(args, cwd);
    return outputPath;
  } catch (error) {
    await removeOutput(outputPath);
    throw error;
  } finally {
    if (temporaryInput) await removeOutput(temporaryInput);
    if (mediaFolder) await removeEmptyMediaFolder(path.join(cwd, mediaFolder));
  }
}

module.exports = {
  MISSING_PANDOC_MESSAGE, convertDocument, killActiveProcesses, runPandoc,
};
