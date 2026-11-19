const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { app } = require('electron');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..');
const ffmpeg = path.join(root, 'bin', 'ffmpeg.exe');
const { convertDocument } = require('../src/converters/document');
const { convertDocumentToPdf } = require('../src/converters/documentPdf');

async function checkPdf(inputPath, expectedPages = 1) {
  const outputPath = await convertDocumentToPdf(inputPath);
  const buffer = await fs.promises.readFile(outputPath);
  assert(buffer.subarray(0, 4).toString() === '%PDF');
  assert(buffer.length > 1024);
  const pages = (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  assert(pages >= expectedPages);
  return outputPath;
}

async function run() {
  await app.whenReady();
  const keepAlive = new (require('electron').BrowserWindow)({ show: false });
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'swiftconvertor-pdf-test-'));
  const tempPrefix = 'swiftconvertor-pdf-';
  const before = (await fs.promises.readdir(os.tmpdir())).filter((name) => name.startsWith(tempPrefix));
  const results = [];
  try {
    const imagePath = path.join(directory, 'local image.png');
    await execFileAsync(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=40x40', '-frames:v', '1', imagePath,
    ]);
    const markdownPath = path.join(directory, 'sample.md');
    const markdown = `# PDF Heading\n\n## Subheading\n\n- one\n- two\n\n\`\`\`js\nconst value = 1;\n\`\`\`\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![Local image](local%20image.png)\n`;
    await fs.promises.writeFile(markdownPath, markdown, 'utf8');
    const longPath = path.join(directory, 'long.md');
    await fs.promises.writeFile(longPath, `${markdown}\n${Array.from({ length: 200 }, (_, index) => `Line ${index + 1}`).join('\n')}`, 'utf8');
    const docxPath = await convertDocument(markdownPath, 'docx');
    const utf8Path = path.join(directory, 'sample.txt');
    await fs.promises.writeFile(utf8Path, 'Accents: café, naïve\n日本語とПривет\n', 'utf8');
    const utf16Path = path.join(directory, 'sample-utf16.txt');
    await fs.promises.writeFile(utf16Path, Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('UTF-16 heading\n日本語\n', 'utf16le'),
    ]));

    await checkPdf(markdownPath);
    const duplicate = await checkPdf(markdownPath);
    assert.strictEqual(path.basename(duplicate), 'sample(pdf) (2).pdf');
    results.push(['Markdown', 'PASS']);
    results.push(['Unique PDF naming', 'PASS']);
    const cases = [
      ['DOCX', docxPath, 1],
      ['UTF-8 TXT', utf8Path, 1],
      ['UTF-16 TXT', utf16Path, 1],
      ['200-line Markdown', longPath, 2],
    ];
    for (const [name, inputPath, pages] of cases) {
      await checkPdf(inputPath, pages);
      results.push([name, 'PASS']);
    }

    const after = (await fs.promises.readdir(os.tmpdir())).filter((name) => name.startsWith(tempPrefix));
    assert.deepStrictEqual(after.sort(), before.sort());
    results.push(['Temporary folder cleanup', 'PASS']);
  } catch (error) {
    results.push(['PDF integration', 'FAIL']);
    console.error(error);
    process.exitCode = 1;
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
    keepAlive.destroy();
    console.log('\nCheck                         Result');
    for (const [check, result] of results) console.log(`${check.padEnd(29)} ${result}`);
    const exitCode = process.exitCode || 0;
    app.quit();
    setTimeout(() => app.exit(exitCode), 0);
  }
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
