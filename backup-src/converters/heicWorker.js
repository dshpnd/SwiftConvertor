const fs = require('fs');
const os = require('os');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const convert = require('heic-convert');

async function decode() {
  const input = await fs.promises.readFile(workerData.inputPath);
  const png = await convert({ buffer: input, format: 'PNG' });
  const outputPath = path.join(
    os.tmpdir(),
    `swiftconvertor-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`,
  );
  await fs.promises.writeFile(outputPath, Buffer.from(png));
  parentPort.postMessage({ outputPath });
}

decode().catch((error) => {
  parentPort.postMessage({ error: error.message });
});
