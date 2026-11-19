const path = require('path');
const { Worker } = require('worker_threads');

function decodeHeic(inputPath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'heicWorker.js'), {
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
