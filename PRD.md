# SwiftConvertor: Windows Offline File Converter (PRD)

Working name: SwiftConvertor (placeholder) · Version 0.1 · Windows 10/11 · Weekend MVP

## 1. Overview

SwiftConvertor is an offline Windows app that converts a file with one drag. A small always-on-top window sits on the desktop. Drag a file onto it, a wheel of valid output formats opens, drop the file on a format, and the converted copy appears next to the original. Nothing is ever uploaded.

It is inspired by Tangerine for Mac (drag a file, pick a format from a wheel, everything local). Tangerine detects drags anywhere on screen, which is very hard on Windows, so this MVP uses a drop-zone window instead.

## 2. Goals and non-goals

**Goals**

- Convert images, audio, video and documents with one drag and one drop.
- Work fully offline with nothing for the user to install: FFmpeg and Pandoc ship inside the app.
- Never overwrite or delete the original file.
- Be demo-ready for a hackathon after one weekend.

**Non-goals (not in MVP)**

- PDF input or output, slides, spreadsheets, subtitles, archives
- File tools (compress, crop, trim, split, merge) and file actions (copy path, terminal)
- System-wide drag detection and the Explorer right-click menu
- macOS or Linux, accounts, cloud, auto-update, code signing

## 3. Users

- Students, creators and office users who convert files often and do not want to upload private files to websites.
- Hackathon judges. The pitch is privacy, speed and zero clicks.

## 4. User flow

1. Launch the app. A small floating circle (the drop zone) appears on top of other windows.
2. Drag a file from Explorer or the desktop over the circle. The window grows and the wheel opens, showing the valid output formats for that file type (the source format is left out).
3. Drop the file on a wedge. The wheel shows Converting…
4. Done: the new file is saved beside the original as `name(ext).ext`, a notification offers Show in folder, and the window shrinks back. If that name exists, use `name(ext) (2).ext`, then `(3)` and so on.
5. Keyboard path: click the circle, pick a file in the dialog, and the wheel opens. Arrow keys move, Enter applies, Esc cancels.
6. Cancel at any time with Esc, or by dropping outside the wedges.

## 5. MVP features


| ID  | Feature                                                                                    | Priority |
| --- | ------------------------------------------------------------------------------------------ | -------- |
| F1  | Frameless, always-on-top, draggable drop-zone window that grows when a file hovers over it | P0       |
| F2  | Wheel menu with one wedge per valid output format                                          | P0       |
| F3  | Image, audio and video conversion with FFmpeg                                              | P0       |
| F4  | Document conversion with Pandoc                                                            | P0       |
| F5  | Output saved beside the original with safe naming                                          | P0       |
| F6  | Plain-English error messages                                                               | P0       |
| F7  | Keyboard path (file dialog, arrows, Enter, Esc)                                            | P1       |
| F8  | Batch: several files of the same type converted one after another                          | P1       |
| F9  | System tray icon with Show and Quit                                                        | P1       |
| F10 | Progress bar and cancel button for long video conversions                                  | P1       |
| F11 | Log file in `%APPDATA%/``S``w``if``tCo``nver``tor``/logs/`                                 | P1       |


## 6. Supported formats (MVP)


| Category  | Input                          | Output                                          | Engine |
| --------- | ------------------------------ | ----------------------------------------------- | ------ |
| Images    | JPG, PNG, WebP, BMP, TIFF      | JPG, PNG, WebP, BMP, TIFF                       | FFmpeg |
| Audio     | MP3, M4A, WAV, FLAC, OGG, Opus | MP3, M4A, WAV, FLAC, OGG, Opus                  | FFmpeg |
| Video     | MP4, MOV, MKV, WebM, AVI       | MP4, MOV, MKV, WebM, AVI, GIF, MP3 (audio only) | FFmpeg |
| Documents | DOCX, MD, TXT, HTML, EPUB      | DOCX, MD, TXT, HTML, EPUB, RTF                  | Pandoc |


Later (P2): AVIF, HEIC, SVG input, AIFF, WMA, WMV, SRT and VTT subtitles. TXT files are read as Markdown. A drop that mixes file types is rejected with a message.

## 7. Wheel menu spec

- A circle divided into wedges, one per valid output format (maximum 8). The wedge label is the format name, for example PNG.
- The center shows the file name and its type.
- Hovering a wedge highlights it. Dropping on a wedge starts the conversion. Dropping anywhere else cancels.
- Keyboard: arrow keys move the highlight, Enter applies, Esc cancels.
- Opens in under 150 ms with a smooth animation, dark rounded style.
- Window sizes: idle about 140 x 140 px, active about 440 x 440 px, centered on the same point.

## 8. Technical architecture

**Stack:** Electron (JavaScript), plain HTML, CSS and JS for the interface (no framework), FFmpeg, Pandoc, electron-builder for the installer.

**Folder structure**

```
/bin                 ffmpeg.exe, ffprobe.exe, pandoc.exe
/src/main/main.js    window, tray, IPC, runs the tools
/src/main/preload.js safe bridge between window and main
/src/renderer/       index.html, styles.css, wheel.js
/src/converters/     formats.js, ffmpeg.js, pandoc.js
```

**Rules for the code (give these to Cursor)**

- The window never touches the file system directly. It talks to the main process through preload and IPC, with contextIsolation on.
- Get a dropped file’s path with `webUtils.getPathForFile(file)` in preload, not `file.path`.
- Run FFmpeg and Pandoc with `child_process.spawn` and an arguments array, never one long command string, because paths contain spaces.
- Find the tools in `./bin` during development and in `process.resourcesPath/bin` when packaged. Ship them with electron-builder `extraResources`.
- One file, `formats.js`, is the single source of truth for what converts to what. The wheel and the converters both read from it.
- The copies of FFmpeg and Pandoc installed with winget are for development only. The shipped app carries its own: the FFmpeg essentials build from gyan.dev (includes ffprobe, x264, VP9, MP3, Opus, Vorbis) and `pandoc.exe` from Pandoc’s Windows zip.

## 9. Conversion commands (starter values)

All FFmpeg calls use `-y -i <input>` first and the output path last. Cursor may tune the values.


| Target                 | Arguments                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| JPG                    | `-q:v 2` (transparent areas become white)                                                     |
| PNG, BMP, TIFF         | defaults                                                                                      |
| WebP                   | `-c:v libwebp -quality 90`                                                                    |
| MP3                    | `-vn -c:a libmp3lame -q:a 2`                                                                  |
| M4A                    | `-vn -c:a aac -b:a 192k`                                                                      |
| WAV                    | `-vn -c:a pcm_s16le`                                                                          |
| FLAC                   | `-vn -c:a flac`                                                                               |
| OGG                    | `-vn -c:a libvorbis -q:a 5`                                                                   |
| Opus                   | `-vn -c:a libopus -b:a 128k`                                                                  |
| MP4, MOV               | `-c:v libx264 -crf 23 -preset medium -c:a aac -movflags +faststart`                           |
| MKV                    | `-c:v libx264 -crf 23 -c:a aac`                                                               |
| WebM                   | `-c:v libvpx-vp9 -crf 32 -b:v 0 -c:a libopus`                                                 |
| AVI                    | `-c:v mpeg4 -q:v 4 -c:a libmp3lame`                                                           |
| GIF                    | `-an -vf fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse` |
| Audio from video (MP3) | same as MP3                                                                                   |
| Documents              | `pandoc <input> -f <reader> -t <writer> -o <output>`                                          |


Pandoc readers: docx, markdown, html, epub. Writers: docx, markdown, plain (for TXT), html, epub, rtf. Add `-s` for HTML and RTF, `--metadata title=<file name>` for EPUB, and `--extract-media` when converting DOCX to Markdown.

## 10. Output and error rules

- Save the result beside the original as `name(ext).ext`, with the target extension lowercase in both places. If that name exists, use `name(ext) (2).ext`, then `(3)` and so on.
- Never overwrite or delete the original.
- If the file type is wrong, the file is unreadable or the tool fails: show a plain-English message, delete any half-written output, and keep the app open.
- PNG with transparency converted to JPG or BMP gets a white background, not black.
- Long conversions show a progress state. In P1 this becomes a progress bar with a cancel button that stops the tool process.

## 11. Non-functional requirements

- Fully offline. Zero network calls.
- Typical speed on a mid-range laptop: 5 MB image under 2 seconds, 3-minute MP3 under 10 seconds, 1-minute 1080p video under 60 seconds.
- Installer around 250 MB or less, installs for the current user without admin rights.
- Windows 10 and 11, 64-bit.

## 12. Acceptance tests


| #   | Test                                             | Pass when                                            |
| --- | ------------------------------------------------ | ---------------------------------------------------- |
| 1   | Drag a JPG, choose PNG                           | New PNG sits beside the original and opens correctly |
| 2   | PNG with transparency to JPG                     | Background is white                                  |
| 3   | MP3 to WAV, FLAC and Opus                        | All three files play                                 |
| 4   | MP4 to WebM, GIF and MP3                         | All three files play                                 |
| 5   | DOCX to MD, MD to DOCX, HTML to EPUB             | Results open correctly                               |
| 6   | Convert the same file twice                      | Originals untouched, second copy is named with `name(ext) (2).ext` |
| 7   | File name with spaces and non-English letters    | Converts without error                               |
| 8   | Corrupt or unsupported file                      | Plain-English error, app stays open                  |
| 9   | Wi-Fi off                                        | Tests 1 to 8 still pass                              |
| 10  | Installed on a PC with no Node, FFmpeg or Pandoc | Tests 1 to 8 still pass                              |


## 13. Build phases

Commit to Git after every phase that works.


| Phase | Work                                                              | Done when                                                                 |
| ----- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1     | Empty Electron app                                                | Window opens with `npm start`                                             |
| 2     | Drop zone                                                         | Frameless always-on-top window accepts a file and shows its name and type |
| 3     | Format table and wheel (fake conversions)                         | Wedges match the file type, hover and drop work, Esc cancels              |
| 4     | Image conversion with FFmpeg                                      | Acceptance tests 1 and 2 pass                                             |
| 5     | Audio and video conversion                                        | Acceptance tests 3 and 4 pass                                             |
| 6     | Document conversion with Pandoc                                   | Acceptance test 5 passes                                                  |
| 7     | Polish: naming, errors, notifications, tray, keyboard path, batch | Tests 6 to 8 pass                                                         |
| 8     | Package with electron-builder and bundle the tools                | Tests 9 and 10 pass                                                       |


Build one test installer right after Phase 4 so packaging problems show up early.

## 14. Risks


| Risk                                                   | Plan                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Window growing when a file hovers is flaky             | Fall back to a fixed 440 x 440 px translucent window                   |
| Tools not found after packaging                        | Resolve paths with `process.resourcesPath` and test an installer early |
| FFmpeg build is missing a codec                        | Use the gyan.dev essentials build and test every format early          |
| Windows SmartScreen warns about the unsigned installer | Click More info, then Run anyway. Mention it in the demo               |
| FFmpeg and Pandoc licenses                             | Include their license files in the app folder                          |


## 15. Hackathon demo script

1. Turn Wi-Fi off on screen.
2. Drag a PNG, drop on JPG.
3. Drag a video, drop on GIF.
4. Drag a DOCX, drop on MD.
5. Open the folder: originals untouched, new copies beside them.

Pitch line: your files never leave your PC.

## 16. After the hackathon

PDF tools, slides, spreadsheets, subtitles, archives, system-wide drag detection, file tools (compress, trim, merge) and an Explorer right-click menu.