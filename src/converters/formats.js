const path = require('path');

const formats = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif'],
  audio: ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus'],
  video: ['mp4', 'mov', 'mkv', 'webm', 'avi'],
  document: ['docx', 'md', 'markdown', 'txt'],
  pdf: ['pdf'],
};

const outputs = {
  image: ['jpg', 'png', 'webp', 'bmp', 'tiff', 'pdf'],
  audio: ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus'],
  video: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'gif', 'mp3'],
  document: ['docx', 'md', 'txt', 'pdf'],
  pdf: ['txt', 'png', 'jpg'],
};

function normalizeExtension(extension) {
  const normalized = extension.toLowerCase();
  if (normalized === 'jpeg') return 'jpg';
  if (normalized === 'tif') return 'tiff';
  if (normalized === 'heif') return 'heic';
  if (normalized === 'markdown') return 'md';
  return normalized;
}

function getCategory(filePath) {
  const extension = normalizeExtension(path.extname(filePath).slice(1));

  for (const [category, extensions] of Object.entries(formats)) {
    if (extensions.map(normalizeExtension).includes(extension)) {
      return category;
    }
  }

  return 'unsupported';
}

function getOutputs(category, sourceExt) {
  const source = normalizeExtension(sourceExt);
  return (outputs[category] || []).filter((extension) => extension !== source);
}

function getOutputsForMany(category, extensions) {
  const normalized = extensions.map(normalizeExtension);
  if (!normalized.length) {
    return [...(outputs[category] || [])];
  }
  return (outputs[category] || []).filter((extension) => !normalized.every((source) => source === extension));
}

module.exports = {
  formats, outputs, normalizeExtension, getCategory, getOutputs, getOutputsForMany,
};
