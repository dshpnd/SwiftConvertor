const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const { getBinaryPath, runFfmpeg } = require('../converters/ffmpeg');
const { convertImage } = require('../converters/image');
const { convertDocument } = require('../converters/document');
const { convertDocumentToPdf } = require('../converters/documentPdf');
const { getPopplerPath, pdfToText, pdfToImages } = require('../converters/pdfTools');
const { decodeHeic } = require('../converters/heic');

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function outputPathFromArg() {
  const explicit = argumentValue('--out');
  if (explicit) return explicit;
  const selfTestIndex = process.argv.indexOf('--self-test');
  const positional = selfTestIndex >= 0 ? process.argv[selfTestIndex + 1] : null;
  if (positional && !positional.startsWith('--') && path.extname(positional).toLowerCase() === '.json') {
    return path.resolve(positional);
  }
  return path.join(os.tmpdir(), 'swiftconvertor-selftest.json');
}

function baseRecord(name, binaryPath = '') {
  return { test: name, pass: false, error: '', binaryPath };
}

function passRecord(record) {
  record.pass = true;
  return record;
}

async function statNonEmpty(filePath) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error('Output is missing or empty');
  return stat.size;
}

function assertName(outputPath, originalName, target) {
  if (!path.basename(outputPath).startsWith(`${originalName}(${target})`)) {
    throw new Error(`Unexpected output name: ${path.basename(outputPath)}`);
  }
  if (path.extname(outputPath).toLowerCase() !== `.${target}`) {
    throw new Error(`Unexpected output extension: ${path.extname(outputPath)}`);
  }
}

async function assertText(outputPath, expected) {
  await statNonEmpty(outputPath);
  const text = await fs.promises.readFile(outputPath, 'utf8');
  if (!text.includes(expected)) throw new Error(`Expected text not found: ${expected}`);
}

async function run() {
  console.log('self-test run started');
  console.log('self-test report path:', outputPathFromArg());
  const report = [];
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'swiftconvertor-selftest-'));
  const tempPrefix = 'swiftconvertor-';
  const tempBefore = new Set((await fs.promises.readdir(os.tmpdir()))
    .filter((name) => name.startsWith(tempPrefix)));

  let pngPath;
  let mdPath;
  let txtPath;
  let docxPath;
  let pdfPath;

  const ffmpegPath = getBinaryPath('ffmpeg.exe');
  const pandocPath = getBinaryPath('pandoc.exe');
  const popplerTextPath = getPopplerPath('pdftotext.exe');
  const popplerPpmPath = getPopplerPath('pdftoppm.exe');

  for (const [name, binaryPath] of [
    ['Resolve ffmpeg', ffmpegPath],
    ['Resolve pandoc', pandocPath],
    ['Resolve pdftotext', popplerTextPath],
    ['Resolve pdftoppm', popplerPpmPath],
  ]) {
    const record = baseRecord(name, binaryPath);
    try {
      if (app.isPackaged) {
        const expected = path.resolve(process.resourcesPath, 'bin');
        if (!path.resolve(binaryPath).startsWith(expected + path.sep)) {
          throw new Error(`Packaged binary resolved outside resources\\bin: ${binaryPath}`);
        }
      }
      await statNonEmpty(binaryPath);
      passRecord(record);
    } catch (error) {
      record.error = error.message;
    }
    report.push(record);
  }

  async function test(name, binaryPath, operation) {
    const record = baseRecord(name, binaryPath);
      console.log('self-test:', name);
    try {
      await operation();
        console.log('self-test pass:', name);
        passRecord(record);
      } catch (error) {
        record.error = error.message || String(error);
        console.log('self-test fail:', name, record.error);
    }
    report.push(record);
  }

  await test('Create test PNG', ffmpegPath, async () => {
    pngPath = path.join(directory, 'test source.png');
    await execFileAsync(ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64',
      '-frames:v', '1', pngPath,
    ]);
    await statNonEmpty(pngPath);
  });

  for (const target of ['jpg', 'webp', 'bmp', 'tiff']) {
    await test(`PNG to ${target}`, ffmpegPath, async () => {
      const output = await convertImage(pngPath, target, 'balanced');
      assertName(output, 'test source', target);
      await statNonEmpty(output);
    });
  }

  await test('PNG to PDF', ffmpegPath, async () => {
    const output = await convertImage(pngPath, 'pdf', 'balanced');
    assertName(output, 'test source', 'pdf');
    await statNonEmpty(output);
  });

  await test('Create Markdown and text sources', pandocPath, async () => {
    mdPath = path.join(directory, 'test.md');
    txtPath = path.join(directory, 'test.txt');
    await fs.promises.writeFile(mdPath, '# Heading\n\nAccents: café naïve\n日本語 and Привет\n', 'utf8');
    await fs.promises.writeFile(txtPath, 'Text heading\n\nAccents: café naïve\n日本語 and Привет\n', 'utf8');
  });

  await test('DOCX via Pandoc', pandocPath, async () => {
    docxPath = await convertDocument(mdPath, 'docx');
    assertName(docxPath, 'test', 'docx');
    await statNonEmpty(docxPath);
  });

  await test('MD to DOCX', pandocPath, async () => {
    const output = await convertDocument(mdPath, 'docx');
    assertName(output, 'test', 'docx');
    await statNonEmpty(output);
  });

  await test('MD to TXT', pandocPath, async () => {
    const output = await convertDocument(mdPath, 'txt');
    assertName(output, 'test', 'txt');
    await assertText(output, 'Heading');
  });

  await test('MD to PDF', pandocPath, async () => {
    const output = await convertDocumentToPdf(mdPath);
    assertName(output, 'test', 'pdf');
    await statNonEmpty(output);
  });

  await test('DOCX to MD', pandocPath, async () => {
    const output = await convertDocument(docxPath, 'md');
    assertName(output, 'test(docx)', 'md');
    await assertText(output, 'Heading');
  });

  await test('DOCX to TXT', pandocPath, async () => {
    const output = await convertDocument(docxPath, 'txt');
    assertName(output, 'test(docx)', 'txt');
    await assertText(output, 'Heading');
  });

  await test('DOCX to PDF', pandocPath, async () => {
    const output = await convertDocumentToPdf(docxPath);
    assertName(output, 'test(docx)', 'pdf');
    await statNonEmpty(output);
  });

  await test('TXT to DOCX', pandocPath, async () => {
    const output = await convertDocument(txtPath, 'docx');
    assertName(output, 'test', 'docx');
    await statNonEmpty(output);
  });

  await test('TXT to MD', pandocPath, async () => {
    const output = await convertDocument(txtPath, 'md');
    assertName(output, 'test', 'md');
    await assertText(output, 'Text heading');
  });

  await test('TXT to PDF', pandocPath, async () => {
    const output = await convertDocumentToPdf(txtPath);
    assertName(output, 'test', 'pdf');
    await statNonEmpty(output);
  });

  await test('Generate PDF for Poppler', pandocPath, async () => {
    pdfPath = await convertDocumentToPdf(mdPath);
  });

  await test('PDF to TXT', popplerTextPath, async () => {
    const output = await pdfToText(pdfPath);
    if (path.extname(output).toLowerCase() !== '.txt') throw new Error('Unexpected PDF text output extension');
    if (!path.basename(output, '.txt').includes('(txt)')) throw new Error(`Unexpected PDF text output name: ${path.basename(output)}`);
    await assertText(output, 'Heading');
  });

  await test('PDF to PNG', popplerPpmPath, async () => {
    const result = await pdfToImages(pdfPath, 'png');
    if (!fs.existsSync(result.outputPath)) throw new Error('PNG folder missing');
    if (result.pages < 1) throw new Error('No PNG pages');
    const files = (await fs.promises.readdir(result.outputPath)).filter((name) => /^page-\d+\.png$/i.test(name));
    if (!files.length) throw new Error('No PNG page files');
    for (const name of files) await statNonEmpty(path.join(result.outputPath, name));
  });

  await test('PDF to JPG', popplerPpmPath, async () => {
    const result = await pdfToImages(pdfPath, 'jpg');
    if (!fs.existsSync(result.outputPath)) throw new Error('JPG folder missing');
    if (result.pages < 1) throw new Error('No JPG pages');
    const files = (await fs.promises.readdir(result.outputPath)).filter((name) => /^page-\d+\.jpg$/i.test(name));
    if (!files.length) throw new Error('No JPG page files');
    for (const name of files) await statNonEmpty(path.join(result.outputPath, name));
  });

  const heicPath = argumentValue('--heic');
  if (heicPath) {
    await test('HEIC to JPG', ffmpegPath, async () => {
      const output = await convertImage(heicPath, 'jpg', 'balanced');
      await statNonEmpty(output);
    });
    await test('HEIC to PNG', ffmpegPath, async () => {
      const output = await convertImage(heicPath, 'png', 'balanced');
      await statNonEmpty(output);
    });
  } else {
    report.push({
      test: 'HEIC',
      pass: true,
      error: 'skipped: no --heic path supplied',
      binaryPath: '',
    });
  }

  await fs.promises.rm(directory, { recursive: true, force: true });
  const tempAfter = new Set((await fs.promises.readdir(os.tmpdir()))
    .filter((name) => name.startsWith(tempPrefix)));
  const remaining = [...tempAfter].filter((name) => !tempBefore.has(name));
  const cleanupRecord = baseRecord('Temporary converter cleanup');
  if (remaining.length) cleanupRecord.error = `Converter temp files remain: ${remaining.join(', ')}`;
  else passRecord(cleanupRecord);
  report.push(cleanupRecord);

  const reportPath = outputPathFromArg();
  await fs.promises.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.promises.writeFile(reportPath, JSON.stringify({
    passed: report.every((record) => record.pass),
    report,
  }, null, 2), 'utf8');
  console.log(JSON.stringify({ reportPath, passed: report.every((record) => record.pass), report }, null, 2));
  return report.every((record) => record.pass);
}

module.exports = { run };
