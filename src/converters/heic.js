const path = require('path');
const { app } = require('electron');
const { Worker } = require('worker_threads');

function decodeHeic(inputPath) {
  return new Promise((resolve, reject) => {
    const workerPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'converters', 'heicWorker.js')
      : path.join(__dirname, 'heicWorker.js');
    const worker = new Worker(workerPath, {
      workerData: { inputPath },
    });
    worker.once('message', (message) => {
      if (message.error) {
        reject(new Error(message.error));
      } else {
        resolve(message.outputPath);
      }
    });
    worker.once('error', reject);
  });
}

module.exports = { decodeHeic };
