const fs = require('fs');
const path = require('path');

function getUniqueOutputPath(inputPath, ext) {
  const directory = path.dirname(inputPath);
  const originalName = path.basename(inputPath, path.extname(inputPath));
  const targetExt = ext.toLowerCase();
  let suffix = `(${targetExt})`;
  let counter = 1;
  let outputPath = path.join(directory, `${originalName}${suffix}.${targetExt}`);

  while (outputPath === inputPath || fs.existsSync(outputPath)) {
    counter += 1;
    suffix = `(${targetExt}) (${counter})`;
    outputPath = path.join(directory, `${originalName}${suffix}.${targetExt}`);
  }

  return outputPath;
}

module.exports = { getUniqueOutputPath };
