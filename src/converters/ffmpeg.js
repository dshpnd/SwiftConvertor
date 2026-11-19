const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { spawn } = require('child_process');

const MISSING_FFMPEG_MESSAGE = 'FFmpeg is missing. Put ffmpeg.exe in the bin folder.';
const activeProcesses = new Set();

function getBinaryPath(name, missingMessage = MISSING_FFMPEG_MESSAGE) {
  const binDirectory = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '..', '..', 'bin');
  const binaryPath = path.join(binDirectory, name);

  if (!fs.existsSync(binaryPath)) {
    throw new Error(missingMessage);
  }

  return binaryPath;
}

function runFfmpeg(args) {
  const binaryPath = getBinaryPath('ffmpeg.exe');
  const fullArgs = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', ...args];

  return new Promise((resolve, reject) => {
    const process = spawn(binaryPath, fullArgs, { windowsHide: true });
    activeProcesses.add(process);
    let stderr = '';

    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    process.on('error', (error) => {
      activeProcesses.delete(process);
      reject(error);
    });
    process.on('close', (code) => {
      activeProcesses.delete(process);
      if (code === 0) {
        resolve();
        return;
      }

      const errorLines = stderr.trim().split(/\r?\n/).filter(Boolean);
      reject(new Error(errorLines.slice(-20).join('\n') || `FFmpeg exited with code ${code}`));
    });
  });
}

function killActiveProcesses() {
  for (const child of activeProcesses) {
    if (!child.killed) child.kill();
  }
  activeProcesses.clear();
}

module.exports = {
  MISSING_FFMPEG_MESSAGE, getBinaryPath, runFfmpeg, killActiveProcesses,
};
