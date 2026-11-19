const dropZone = document.getElementById('drop-zone');
const fileNameEl = document.getElementById('file-name');
const fileCategoryEl = document.getElementById('file-category');
const quitButton = document.getElementById('quit-button');

let dragCount = 0;
let activeCategory = null;
let pendingFiles = [];
let messageTimer = null;
let dragLeaveTimer = null;
let conversionRunning = false;
let selectedFormat = null;
let state = 'idle';
let dragOverFrame = null;

const validTransitions = {
  idle: ['armed'],
  armed: ['idle', 'wheelOpen'],
  wheelOpen: ['idle', 'converting', 'done'],
  converting: ['done'],
  done: ['idle'],
};

function changeState(next, reason) {
  if (state === next) return true;
  if (!validTransitions[state].includes(next)) {
    console.log('state transition ignored:', state, '->', next, reason);
    return false;
  }
  console.log('state transition:', state, '->', next, reason);
  state = next;
  return true;
}

function isWheelOpen() {
  return state === 'wheelOpen' || state === 'converting' || state === 'done';
}

const mimeCategories = {
  'text/plain': 'document',
  'text/markdown': 'document',
  'text/x-markdown': 'document',
  'text/html': 'document',
  'application/epub+zip': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/msword': 'document',
};

function preventDefaults(event) {
  event.preventDefault();
}

function categoryFromMime(type) {
  if (['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif'].includes(type)) {
    return 'image';
  }
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  return mimeCategories[type] || null;
}

function setHover(isHovering) {
  dropZone.classList.toggle('hover', isHovering);
}

function resetDragState() {
  clearTimeout(dragLeaveTimer);
  dragLeaveTimer = null;
  if (dragOverFrame) {
    cancelAnimationFrame(dragOverFrame);
    dragOverFrame = null;
  }
  dragCount = 0;
  dropZone.classList.remove('detecting');
  setHover(false);
  window.wheel.clearActive();
}

async function resetAll() {
  resetDragState();
  clearTimeout(messageTimer);
  messageTimer = null;
  conversionRunning = false;
  selectedFormat = null;
  activeCategory = null;
  pendingFiles = [];
  dropZone.classList.remove('expanded', 'message', 'has-file');
  fileNameEl.textContent = 'Drop file';
  fileCategoryEl.textContent = '';
  if (state !== 'idle') {
    if (!changeState('idle', 'reset')) return;
    await window.api.collapseWindow();
  }
}

async function expand(category, sourceExts = [], fileLabel = '') {
  if (!changeState('wheelOpen', 'drag recognized')) return;
  activeCategory = category;
  setHover(true);
  dropZone.classList.add('expanded');
  await window.api.expandWindow();
  if (state !== 'wheelOpen') return;
  await window.wheel.show(category, sourceExts, fileLabel, chooseFormat);
}

async function collapse() {
  dropZone.classList.remove('expanded');
  window.wheel.hide('collapse');
  if (state !== 'idle') {
    changeState('idle', 'drag left');
    await window.api.collapseWindow();
  }
}

function showMessage(message, duration = 1500) {
  clearTimeout(messageTimer);
  dropZone.classList.remove('expanded');
  dropZone.classList.add('message');
  window.wheel.hide('message');
  fileNameEl.textContent = message;
  fileCategoryEl.textContent = '';
  messageTimer = setTimeout(resetAll, duration);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function chooseFormat(format, index = -1) {
  if (state !== 'wheelOpen' || conversionRunning || !pendingFiles.length) {
    console.log('wedge chosen early return:', conversionRunning ? 'conversion running' : 'no pending files');
    return;
  }

  changeState('converting', 'format chosen');
  selectedFormat = format;
  console.log('wedge chosen:', index, format);
  const category = pendingFiles[0].info.category;
  const files = pendingFiles.slice();
  conversionRunning = true;
  console.log('convert start:', files.length, format);
  const result = {
    count: files.length,
    saved: 0,
    skipped: 0,
    failed: 0,
    outputs: [],
    firstName: '',
    error: '',
  };

  try {
    for (let index = 0; index < files.length; index += 1) {
      const current = files[index];
      window.wheel.showCenterMessage(`Converting ${index + 1} of ${files.length}...`);
      console.log('batch progress:', index + 1, 'of', files.length, current.info.name);
      if (category !== 'image') {
        await delay(1500);
        result.saved += 1;
        if (!result.firstName) result.firstName = current.info.name;
        continue;
      }

      try {
        const conversion = await window.api.convert(current.filePath, format);
        console.log('convert result:', JSON.stringify(conversion));
        if (conversion.skipped) {
          result.skipped += 1;
        } else if (conversion.ok) {
          result.saved += 1;
          result.outputs.push(conversion.outputPath);
          if (!result.firstName) result.firstName = conversion.outputPath.split(/[\\/]/).pop();
        } else {
          result.failed += 1;
          result.error = conversion.error;
        }
      } catch (error) {
        console.log('convert result:', error.message);
        result.failed += 1;
        result.error = 'Could not convert this file.';
      }
    }

    if (result.failed === result.count) {
      window.wheel.showFinish({ error: result.error || 'Could not convert this file.' }, resetAll);
    } else {
      window.wheel.showFinish({
        ...result,
        firstOutput: result.outputs[0],
      }, resetAll);
    }
  } finally {
    conversionRunning = false;
    changeState('done', 'conversion finished');
  }
}

function dragSummary(items) {
  const types = Array.from(items).map((item) => item.type || '');
  const categories = types.map(categoryFromMime);
  if (!types.length || categories.some((category) => !category) || new Set(categories).size !== 1) {
    return null;
  }
  return { category: categories[0], count: types.length };
}

document.addEventListener('dragenter', async (event) => {
  preventDefaults(event);
  if (conversionRunning) {
    console.log('dragenter early return: conversion running');
    return;
  }
  if (state === 'wheelOpen' || state === 'converting' || state === 'done') {
    console.log('dragenter early return: wheel already open');
    return;
  }
  clearTimeout(dragLeaveTimer);
  const types = Array.from(event.dataTransfer.items || []).map((item) => item.type || '');
  console.log('dragenter:', types.join(', '));
  if (state === 'idle') changeState('armed', 'dragenter');
  dragCount += 1;
  if (dragCount !== 1 || state !== 'armed') return;
  const summary = dragSummary(event.dataTransfer.items || []);
  if (summary) {
    await expand(summary.category, [], `${summary.count} ${summary.category}${summary.count === 1 ? '' : 's'}`);
  } else {
    setHover(true);
    dropZone.classList.add('detecting');
    fileNameEl.textContent = 'Release to detect';
  }
});

document.addEventListener('dragover', (event) => {
  preventDefaults(event);
  event.dataTransfer.dropEffect = 'copy';
  if (!isWheelOpen() || conversionRunning) return;
  if (dragOverFrame) return;
  dragOverFrame = requestAnimationFrame(() => {
    dragOverFrame = null;
    const wedgeIndex = window.wheel.wedgeIndexFromEvent(event);
    window.wheel.setActive(wedgeIndex);
    if (window.wheel.onDragOver) window.wheel.onDragOver(event, wedgeIndex);
  });
});

document.addEventListener('dragleave', (event) => {
  preventDefaults(event);
  console.log('dragleave');
  if (conversionRunning) {
    console.log('dragleave early return: conversion running');
    return;
  }
  dragCount -= 1;
  if (dragCount <= 0) {
    clearTimeout(dragLeaveTimer);
    dragLeaveTimer = setTimeout(() => {
      if (dragCount !== 0) return;
      resetDragState();
      fileNameEl.textContent = 'Drop file';
      if (state === 'wheelOpen' || state === 'armed') resetAll();
    }, 150);
  }
});

async function handleDrop(event, suppliedWedgeIndex = null) {
  preventDefaults(event);
  console.log('drop');
  resetDragState();
  if (conversionRunning) {
    console.log('drop early return: conversion running');
    return;
  }
  const wedgeIndex = suppliedWedgeIndex === null
    ? (isWheelOpen() ? window.wheel.wedgeIndexFromEvent(event) : -1)
    : suppliedWedgeIndex;
  console.log('drop wedge index:', wedgeIndex);
  const hadPendingFiles = pendingFiles.length > 0;
  const files = Array.from(event.dataTransfer.files || []);
  const paths = files.map((file) => window.api.getFilePath(file));
  if (!paths.length) {
    console.log('drop early return: no files');
    await resetAll();
    return;
  }

  const infos = await window.api.getFilesInfo(paths);
  console.log('getFilesInfo result:', JSON.stringify(infos));
  const categories = new Set(infos.map((info) => info.category));
  if (categories.size !== 1 || infos.some((info) => info.category === 'unsupported')) {
    if (infos.length === 1 && infos[0].category === 'unsupported') {
      console.log('drop early return: single unsupported file');
      showMessage('Unsupported file');
    } else {
      console.log('drop early return: mixed categories or unsupported files');
      showMessage('Drop one kind of file at a time.');
    }
    return;
  }

  pendingFiles = infos.map((info, index) => ({ info, filePath: paths[index] }));
  const category = infos[0].category;
  const label = infos.length === 1 ? infos[0].name : `${infos.length} ${category}s`;
  fileNameEl.textContent = label;
  fileCategoryEl.textContent = category;
  dropZone.classList.add('has-file');

  if (!isWheelOpen()) {
    console.log('drop early return: wheel was not open, opening it');
    await expand(category, infos.map((info) => info.extension), label);
    return;
  }

  if (state !== 'wheelOpen') return;
  await window.wheel.show(category, infos.map((info) => info.extension), label, chooseFormat);
  const finalWedgeIndex = window.wheel.wedgeIndexFromEvent(event);
  console.log('drop final wedge index:', finalWedgeIndex);
  if (finalWedgeIndex >= 0 && finalWedgeIndex < window.wheel.outputs.length) {
    console.log('drop starting wedge:', finalWedgeIndex, window.wheel.outputs[finalWedgeIndex]);
    chooseFormat(window.wheel.outputs[finalWedgeIndex], finalWedgeIndex);
  } else if (hadPendingFiles || isWheelOpen()) {
    console.log('drop early return: outside wheel or center circle');
    await resetAll();
  }
}

window.addEventListener('load', () => {
  window.wheel.setDragHandlers(
    null,
    (event, wedgeIndex) => handleDrop(event, wedgeIndex),
  );
});

document.addEventListener('drop', (event) => {
  if (isWheelOpen() && wheelContainerContains(event.target)) {
    console.log('drop early return: handled by wheel container');
    return;
  }
  handleDrop(event);
});

function wheelContainerContains(target) {
  return target && target.closest && target.closest('#wheel-container');
}

document.addEventListener('dragend', () => {
  console.log('dragend');
  resetDragState();
});

dropZone.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.drag-handle')) return;
  event.preventDefault();
  window.api.showContextMenu();
});

window.api.onQualityChange((quality) => {
  console.log('quality changed:', quality);
  window.wheel.quality = quality;
  const qualityElement = document.querySelector('.wheel-quality');
  if (qualityElement) qualityElement.textContent = quality;
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && (state === 'wheelOpen' || state === 'done')) resetAll();
  if (!isWheelOpen() || !window.wheel.outputs.length) return;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    const next = (window.wheel.selectedIndex + 1) % window.wheel.outputs.length;
    window.wheel.highlight(next);
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    const next = (window.wheel.selectedIndex - 1 + window.wheel.outputs.length) % window.wheel.outputs.length;
    window.wheel.highlight(next);
  }
  if (event.key === 'Enter' && window.wheel.selectedIndex >= 0) {
    chooseFormat(window.wheel.outputs[window.wheel.selectedIndex], window.wheel.selectedIndex);
  }
});

quitButton.addEventListener('click', (event) => {
  event.stopPropagation();
  window.close();
});
