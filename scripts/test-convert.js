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
const { convertImage } = require('../src/converters/image');
const { convertDocument } = require('../src/converters/document');
const { getOutputs } = require('../src/converters/formats');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { convertToPdf } = require('../src/converters/imagePdf');
const { pdfToText, pdfToImages, getPopplerPath } = require('../src/converters/pdfTools');

async function run() {
  await app.whenReady();
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'swiftconvertor-test-'));
  const tempPrefix = `swiftconvertor-${process.pid}-`;
  const tempFilesBefore = new Set((await fs.promises.readdir(os.tmpdir()))
    .filter((name) => name.startsWith(tempPrefix)));
  try {
    app.setPath('userData', path.join(directory, 'user-data'));
    const { getQuality } = require('../src/main/settings');
    assert.strictEqual(getQuality(), 'balanced');
    await fs.promises.mkdir(path.join(directory, 'user-data'), { recursive: true });
    await fs.promises.writeFile(path.join(directory, 'user-data', 'settings.json'), '{broken');
    assert.strictEqual(getQuality(), 'balanced');

    const sourcePath = path.join(directory, 'test source.png');
    await execFileAsync(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'color=c=red:s=32x32', '-frames:v', '1', sourcePath,
    ]);

    const sourceExtensions = ['jpg', 'png', 'webp', 'bmp', 'tiff'];
    const sourceFiles = {};
    const originalSize = (await fs.promises.stat(sourcePath)).size;
    for (const extension of sourceExtensions) {
      const source = path.join(directory, `test(${extension}).${extension}`);
      await convertImage(sourcePath, extension);
      const generated = path.join(directory, `test source(${extension}).${extension}`);
      await fs.promises.rename(generated, source);
      sourceFiles[extension] = source;
    }

    for (const [sourceExtension, inputPath] of Object.entries(sourceFiles)) {
      for (const target of getOutputs('image', sourceExtension)) {
        const outputPath = await convertImage(inputPath, target);
        const stat = await fs.promises.stat(outputPath);
        assert(stat.size > 0, `${outputPath} is empty`);
        assert(path.basename(outputPath).startsWith(`test(${sourceExtension})`));
        assert.strictEqual(path.extname(outputPath), `.${target}`);
      }
      const pdfPath = await convertImage(inputPath, 'pdf');
      assert((await fs.promises.stat(pdfPath)).size > 0);
    }
    assert.strictEqual((await fs.promises.stat(sourcePath)).size, originalSize);

    const duplicate = await convertImage(sourceFiles.png, 'jpg');
    assert(duplicate.includes('(jpg) (2).jpg'));
    assert((await fs.promises.stat(sourceFiles.png)).size > 0);

    const variants = [
      path.join(directory, 'sp ace [x] É.JPG'),
      path.join(directory, 'no-extension'),
    ];
    await fs.promises.copyFile(sourceFiles.jpg, variants[0]);
    await fs.promises.copyFile(sourceFiles.jpg, variants[1]);
    assert((await fs.promises.stat(await convertImage(variants[0], 'png'))).size > 0);
    assert((await fs.promises.stat(await convertImage(variants[1], 'png'))).size > 0);

    const corrupt = path.join(directory, 'corrupt.jpg');
    await fs.promises.writeFile(corrupt, 'not an image');
    await assert.rejects(() => convertImage(corrupt, 'png'));
    assert(!(await fs.promises.readdir(directory)).some((name) => name.startsWith('corrupt(')));

    const missingFolderInput = path.join(directory, 'missing-folder', 'input.jpg');
    await assert.rejects(() => convertImage(missingFolderInput, 'png'));
    assert(!(await fs.promises.readdir(directory)).some((name) => name.startsWith('input(')));

    const tempFilesAfter = new Set((await fs.promises.readdir(os.tmpdir()))
      .filter((name) => name.startsWith(tempPrefix)));
    assert.deepStrictEqual([...tempFilesAfter].sort(), [...tempFilesBefore].sort());

    const markdownPath = path.join(directory, 'test.md');
    const textPath = path.join(directory, 'test.txt');
    const utf16Path = path.join(directory, 'utf16.txt');
    const markdown = '# Heading\n\n**Bold**\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[Link](https://example.com)\n';
    const text = 'Heading\n\nAccents: café, naïve\n日本語とПривет\n';
    await fs.promises.writeFile(markdownPath, markdown, 'utf8');
    await fs.promises.writeFile(textPath, text, 'utf8');
    await fs.promises.writeFile(utf16Path, Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(text, 'utf16le'),
    ]));

    const markdownDocx = await convertDocument(markdownPath, 'docx');
    const markdownDocxSecond = await convertDocument(markdownPath, 'docx');
    assert.strictEqual(path.basename(markdownDocxSecond), 'test(docx) (2).docx');
    const markdownTxt = await convertDocument(markdownPath, 'txt');
    const textDocx = await convertDocument(textPath, 'docx');
    const textMd = await convertDocument(textPath, 'md');
    const docxMd = await convertDocument(markdownDocx, 'md');
    const docxTxt = await convertDocument(markdownDocx, 'txt');
    for (const outputPath of [markdownDocx, markdownTxt, textDocx, textMd, docxMd, docxTxt]) {
      assert((await fs.promises.stat(outputPath)).size > 0, `${outputPath} is empty`);
      assert(path.basename(outputPath).includes(`(${path.extname(outputPath).slice(1)})`));
    }
    assert((await fs.promises.readFile(markdownTxt, 'utf8')).includes('Heading'));
    assert((await fs.promises.readFile(textMd, 'utf8')).includes('café'));
    assert((await fs.promises.readFile(docxMd, 'utf8')).includes('Heading'));
    assert((await fs.promises.readFile(docxTxt, 'utf8')).includes('Heading'));
    const utf16Md = await convertDocument(utf16Path, 'md');
    assert((await fs.promises.readFile(utf16Md, 'utf8')).includes('日本語'));

    const pdfTextExpected = 'Café crème brûlée — naïve résumé';
    const textPdf = await PDFDocument.create();
    const textFont = await textPdf.embedFont(StandardFonts.Helvetica);
    const textPage = textPdf.addPage([612, 792]);
    textPage.drawText(pdfTextExpected, { x: 72, y: 700, size: 18, font: textFont, color: rgb(0, 0, 0) });
    const textPdfPath = path.join(directory, 'Résumé café 日本語.pdf');
    await fs.promises.writeFile(textPdfPath, await textPdf.save());
    const pdfOriginalSize = (await fs.promises.stat(textPdfPath)).size;
    const textOutput = await pdfToText(textPdfPath);
    const extractedText = await fs.promises.readFile(textOutput, 'utf8');
    assert(extractedText.includes('Caf') && extractedText.includes('br') && extractedText.includes('r'));
    assert.strictEqual((await fs.promises.stat(textPdfPath)).size, pdfOriginalSize);

    const threePdf = await PDFDocument.create();
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const page = threePdf.addPage([612, 792]);
      page.drawText(`Page ${pageIndex + 1}`, { x: 72, y: 700, size: 24, font: textFont });
    }
    const threePdfPath = path.join(directory, 'three page.pdf');
    await fs.promises.writeFile(threePdfPath, await threePdf.save());
    const threeOriginalSize = (await fs.promises.stat(threePdfPath)).size;

    const { setQuality } = require('../src/main/settings');
    setQuality('small');
    const smallPng = await pdfToImages(threePdfPath, 'png');
    assert.strictEqual(smallPng.pages, 3);
    for (const name of ['page-01.png', 'page-02.png', 'page-03.png']) {
      const imagePath = path.join(smallPng.outputPath, name);
      const image = await fs.promises.readFile(imagePath);
      assert(image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
      assert(image.length > 1024);
    }
    const smallSecond = await pdfToImages(threePdfPath, 'png');
    assert(smallSecond.outputPath.endsWith('(png) (2)'));

    setQuality('best');
    const bestPng = await pdfToImages(threePdfPath, 'png');
    const smallSize = (await fs.promises.stat(path.join(smallPng.outputPath, 'page-01.png'))).size;
    const bestSize = (await fs.promises.stat(path.join(bestPng.outputPath, 'page-01.png'))).size;
    assert.notStrictEqual(smallSize, bestSize);

    setQuality('balanced');
    const jpgResult = await pdfToImages(threePdfPath, 'jpg');
    assert.strictEqual(jpgResult.pages, 3);
    for (const name of ['page-01.jpg', 'page-02.jpg', 'page-03.jpg']) {
      const imagePath = path.join(jpgResult.outputPath, name);
      const image = await fs.promises.readFile(imagePath);
      assert.strictEqual(image[0], 0xff);
      assert.strictEqual(image[1], 0xd8);
      assert(image.length > 1024);
    }

    const imageOnlyPdf = await convertToPdf(sourceFiles.png, 'png', path.join(directory, 'image-only.pdf'));
    await assert.rejects(
      () => pdfToText(imageOnlyPdf),
      (error) => error.message === 'No text found in this PDF. It may be a scanned document.',
    );
    assert(!(await fs.promises.readdir(directory)).some((name) => name.startsWith('image-only(txt')));

    const duplicateText = await pdfToText(textPdfPath);
    assert(duplicateText.endsWith('(txt) (2).txt'));

    assert.strictEqual((await fs.promises.stat(threePdfPath)).size, threeOriginalSize);

    const popplerPath = getPopplerPath('pdftotext.exe');
    await fs.promises.rename(popplerPath, `${popplerPath}.missing-test`);
    try {
      await assert.rejects(
        () => pdfToText(textPdfPath),
        (error) => error.message === 'Poppler is missing. Put the poppler folder in the bin folder.',
      );
    } finally {
      await fs.promises.rename(`${popplerPath}.missing-test`, popplerPath);
    }

    console.log('converter integration tests passed');
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
    app.quit();
  }
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
