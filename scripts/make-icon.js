const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const pngToIco = require('png-to-ico');

const root = path.resolve(__dirname, '..');
const buildDirectory = path.join(root, 'build');
const sourcePath = path.join(buildDirectory, 'icon-source.png');
const outputIco = path.join(buildDirectory, 'icon.ico');
const outputPng = path.join(buildDirectory, 'icon.png');
const ffmpeg = path.join(root, 'bin', 'ffmpeg.exe');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, args, { windowsHide: true, shell: false }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function run() {
  await fs.promises.mkdir(buildDirectory, { recursive: true });
  const signature = await fs.promises.readFile(sourcePath);
  const width = signature.readUInt32BE(16);
  const height = signature.readUInt32BE(20);
  if (width !== height) throw new Error(`Logo is not square: ${width}x${height}`);
  if (width < 256 || height < 256) {
    console.warn(`Warning: logo is smaller than 256x256 (${width}x${height}).`);
  }

  await runFfmpeg(['-y', '-i', sourcePath, '-s', '512x512', '-frames:v', '1', outputPng]);

  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'swiftconvertor-icon-'));
  try {
    const sizeFiles = [];
    for (const size of sizes) {
      const sizePath = path.join(tempDirectory, `icon-${size}.png`);
      await runFfmpeg(['-y', '-i', sourcePath, '-s', `${size}x${size}`, '-frames:v', '1', sizePath]);
      sizeFiles.push(sizePath);
    }
    const ico = await pngToIco.default(sizeFiles);
    await fs.promises.writeFile(outputIco, ico);
  } finally {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  }

  console.log(`Created ${outputIco} and ${outputPng}`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
