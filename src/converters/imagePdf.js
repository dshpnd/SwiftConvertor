const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { runFfmpeg } = require('./ffmpeg');
const { decodeHeic } = require('./heic');

function temporaryPath(extension) {
  return path.join(
    os.tmpdir(),
    `swiftconvertor-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`,
  );
}

async function convertToPdf(inputPath, sourceExt, outputPath) {
  const normalized = sourceExt.toLowerCase().replace(/^jpeg$/, 'jpg').replace(/^tif$/, 'tiff').replace(/^heif$/, 'heic');
  const temporaryFiles = [];
  let embedPath = inputPath;

  try {
    if (normalized === 'jpg') {
      embedPath = temporaryPath('jpg');
      temporaryFiles.push(embedPath);
      await runFfmpeg(['-i', inputPath, '-q:v', '2', '-frames:v', '1', embedPath]);
    } else if (normalized === 'heic') {
      embedPath = await decodeHeic(inputPath);
      temporaryFiles.push(embedPath);
    } else if (normalized !== 'png') {
      embedPath = temporaryPath('png');
      temporaryFiles.push(embedPath);
      await runFfmpeg(['-i', inputPath, '-frames:v', '1', embedPath]);
    }

    const imageBytes = await fs.promises.readFile(embedPath);
    const document = await PDFDocument.create();
    const image = normalized === 'jpg' ? await document.embedJpg(imageBytes) : await document.embedPng(imageBytes);
    const portrait = image.height > image.width;
    const pageWidth = portrait ? 595.28 : 841.89;
    const pageHeight = portrait ? 841.89 : 595.28;
    const margin = 24;
    const scale = Math.min(
      (pageWidth - margin * 2) / image.width,
      (pageHeight - margin * 2) / image.height,
    );
    const width = image.width * scale;
    const height = image.height * scale;
    const page = document.addPage([pageWidth, pageHeight]);
    page.drawImage(image, {
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
      width,
      height,
    });
    await fs.promises.writeFile(outputPath, await document.save(), { flag: 'wx' });
    return outputPath;
  } finally {
    await Promise.all(temporaryFiles.map(async (file) => {
      try {
        await fs.promises.unlink(file);
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('Could not remove temporary image:', error);
      }
    }));
  }
}

module.exports = { convertToPdf };
