const fs = require('fs');
const path = require('path');
const fsPromises = require('fs').promises;
const { runFfmpeg } = require('./ffmpeg');
const { getUniqueOutputPath } = require('./naming');
const { decodeHeic } = require('./heic');
const { convertToPdf } = require('./imagePdf');

function normalizeExtension(extension) {
  const normalized = extension.toLowerCase();
  return normalized === 'jpeg'
    ? 'jpg'
    : normalized === 'tif'
      ? 'tiff'
      : normalized === 'heif'
        ? 'heic'
        : normalized;
}

async function convertImage(inputPath, targetExt, quality = 'balanced') {
  const sourceExt = normalizeExtension(path.extname(inputPath).slice(1));
  const target = normalizeExtension(targetExt);
  const outputPath = getUniqueOutputPath(inputPath, target);
  let temporaryInput = null;

  try {
    if (target === 'pdf') {
      return await convertToPdf(inputPath, sourceExt, outputPath);
    }

    let conversionInput = inputPath;
    let conversionSourceExt = sourceExt;
    if (sourceExt === 'heic') {
      temporaryInput = await decodeHeic(inputPath);
      conversionInput = temporaryInput;
      conversionSourceExt = 'png';
      if (target === 'png') {
        await fsPromises.copyFile(temporaryInput, outputPath, fs.constants.COPYFILE_EXCL);
        return outputPath;
      }
    }

    const args = ['-i', conversionInput];
    if ((target === 'jpg' || target === 'bmp') && ['png', 'webp', 'tiff'].includes(conversionSourceExt)) {
      args.push(
        '-filter_complex',
        '[0:v]split[fg][bg0];[bg0]drawbox=x=0:y=0:w=iw:h=ih:color=white@1:t=fill[bg];[bg][fg]overlay=format=auto',
      );
    }

    if (target === 'jpg') {
      args.push('-q:v', quality === 'small' ? '8' : quality === 'best' ? '2' : '4');
    } else if (target === 'webp') {
      args.push('-c:v', 'libwebp', '-quality', quality === 'small' ? '70' : quality === 'best' ? '95' : '85');
    }

    args.push('-frames:v', '1', outputPath);
    await runFfmpeg(args);
    return outputPath;
  } catch (error) {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    throw error;
  } finally {
    if (temporaryInput) {
      try {
        await fsPromises.unlink(temporaryInput);
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('Could not remove HEIC temporary file:', error);
      }
    }
  }
}

module.exports = { convertImage, normalizeExtension };
