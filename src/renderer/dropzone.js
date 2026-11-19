const dropZone = document.getElementById('drop-zone');
const fileNameEl = document.getElementById('file-name');
const fileCategoryEl = document.getElementById('file-category');
const quitButton = document.getElementById('quit-button');

let dragCount = 0;
let activeCategory = null;
let pendingFiles = [];
let conversionRunning = false;
let selectedFormat = null;
let state = 'idle';
let dragOverFrame = null;
let currentRunId = 0;
let dropStartedAt = 0;
let stateEnteredAt = Date.now();
let stateIsError = false;
const timers = new Map();

const validTransitions = {
  idle: ['armed', 'wheelOpen'],
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
  stateEnteredAt = Date.now();
  stateIsError = next === 'done' && reason === 'conversion error';
  document.body.dataset.state = next;
  armWatchdog();
  if (next === 'idle') requestIdleLayoutCheck();
  return true;
}

function isWheelOpen() {
  return state === 'wheelOpen' || state === 'converting' || state === 'done';
}

const mimeCategories = {
  'text/plain': 'document',
  'text/markdown': 'document',
  'text/x-markdown': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
};

function preventDefaults(event) {
  event.preventDefault();
}

function clearTimer(name, reason = 'unspecified') {
  const timer = timers.get(name);
  if (!timer) return;
  clearTimeout(timer.id);
  timers.delete(name);
  console.log('timer clear:', JSON.stringify({
    name, delay: timer.delay, runId: timer.runId, reason,
  }));
  if (timer.onClear) timer.onClear();
}

function clearAllTimers(reason) {
  [...timers.keys()].forEach((name) => clearTimer(name, reason));
}

function startTimer(name, delayMilliseconds, runId, callback, onClear = null) {
  clearTimer(name, 'replace');
  const timer = {
    id: null,
    delay: delayMilliseconds,
    runId,
    onClear,
  };
  console.log('timer start:', JSON.stringify({ name, delay: delayMilliseconds, runId }));
  timer.id = setTimeout(() => {
    if (timers.get(name) !== timer) return;
    timers.delete(name);
    console.log('timer fire:', JSON.stringify({ name, delay: delayMilliseconds, runId }));
    if (runId !== currentRunId) return;
    callback();
  }, delayMilliseconds);
  timers.set(name, timer);
}

function waitForTimer(name, delayMilliseconds, runId) {
  return new Promise((resolve) => {
    startTimer(name, delayMilliseconds, runId, resolve, resolve);
  });
}

function armWatchdog() {
  clearTimer('watchdog', 'state changed');
  if (state === 'converting') {
    startTimer('watchdog', 130000, currentRunId, () => {
      console.error('watchdog: converting state stuck');
      resetAll('watchdog converting');
    });
  } else if (state === 'done') {
    const delayMilliseconds = stateIsError ? 5000 : 10000;
    startTimer('watchdog', delayMilliseconds, currentRunId, () => {
      console.error(`watchdog: ${stateIsError ? 'error' : 'done'} state stuck`);
      resetAll(`watchdog ${stateIsError ? 'error' : 'done'}`);
    });
  }
}

function logWindowMetrics(label) {
  const circle = document.getElementById('drop-zone');
  console.log(`renderer metrics ${label}:`, JSON.stringify({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    circle: circle ? circle.getBoundingClientRect().toJSON() : null,
  }));
}

function dumpIdleLayout() {
  const elements = [document.body, ...document.body.children, ...document.querySelector('.stage').children];
  return elements.map((element) => ({
    element: element.id || element.className || element.tagName,
    display: getComputedStyle(element).display,
    position: getComputedStyle(element).position,
    rect: element.getBoundingClientRect().toJSON(),
  }));
}

function requestIdleLayoutCheck() {
  requestAnimationFrame(() => {
    if (state !== 'idle') return;
    const circle = dropZone.getBoundingClientRect();
    if (Math.abs(circle.width - circle.height) > 1) {
      console.error('idle circle is not round:', JSON.stringify({
        circle: circle.toJSON(),
        layout: dumpIdleLayout(),
      }));
      document.body.dataset.state = 'idle';
      dropZone.classList.remove('expanded', 'message', 'has-file', 'detecting', 'hover');
      dropZone.style.cssText = '';
      window.wheel.hide('idle layout repair');
    }
    console.log('idle circle:', JSON.stringify(circle.toJSON()));
    console.log('idle layout:', JSON.stringify(dumpIdleLayout()));
  });
}

function categoryFromMime(type) {
  if (['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif'].includes(type)) {
    return 'image';
  }
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type === 'application/pdf') return 'pdf';
  return mimeCategories[type] || null;
}

function setHover(isHovering) {
  console.log('hover flag:', isHovering);
  dropZone.classList.toggle('hover', isHovering);
}

function resetDragState() {
  clearTimer('drag-leave', 'drag state reset');
  if (dragOverFrame) {
    cancelAnimationFrame(dragOverFrame);
    dragOverFrame = null;
  }
  dragCount = 0;
  dropZone.classList.remove('detecting');
  setHover(false);
  window.wheel.clearActive();
}

async function resetAll(reason = 'reset') {
  console.log('resetAll():', reason);
  currentRunId += 1;
  clearAllTimers(`resetAll: ${reason}`);
  window.wheel.setRunId(currentRunId);
  window.wheel.clearFinishTimer(`resetAll: ${reason}`);
  resetDragState();
  conversionRunning = false;
  selectedFormat = null;
  activeCategory = null;
  pendingFiles = [];
  dropZone.classList.remove('expanded', 'message', 'has-file');
  dropZone.style.cssText = '';
  fileNameEl.textContent = 'Drop file';
  fileCategoryEl.textContent = '';
  await finishAndCollapse(reason, currentRunId);
}

async function finishAndCollapse(reason, runId) {
  if (runId !== currentRunId) return;
  console.log('finishAndCollapse():', reason, 'runId:', runId);
  clearAllTimers(`finishAndCollapse: ${reason}`);
  window.wheel.clearFinishTimer(`finishAndCollapse: ${reason}`);
  resetDragState();
  if (runId !== currentRunId) return;
  const startedAt = performance.now();
  const wheelContainer = document.getElementById('wheel-container');
  wheelContainer.classList.add('fade-out');
  dropZone.classList.add('fade-out');
  console.log('collapse sequence: fade all content 150ms', JSON.stringify({ runId, reason }));
  await delay(150, runId, 'collapse-fade-out');
  if (runId !== currentRunId) return;
  wheelContainer.classList.remove('fade-out');
  wheelContainer.setAttribute('aria-hidden', 'true');
  wheelContainer.style.cssText = '';
  dropZone.classList.remove('expanded', 'message', 'has-file');
  dropZone.classList.remove('fade-out');
  dropZone.classList.add('fade-in');
  dropZone.style.opacity = '0';
  if (state !== 'idle') {
    if (!changeState('idle', reason)) {
      console.error('finishAndCollapse: idle transition was ignored', state, reason);
      return;
    }
  }
  await window.api.collapseWindow();
  if (runId !== currentRunId) return;
  requestAnimationFrame(() => {
    if (runId !== currentRunId) return;
    dropZone.style.opacity = '';
    dropZone.classList.remove('fade-in');
  });
  const duration = Math.round(performance.now() - startedAt);
  console.log('collapse sequence complete:', JSON.stringify({ runId, reason, durationMs: duration }));
  requestIdleLayoutCheck();
}

async function expand(category, sourceExts = [], fileLabel = '') {
  clearAllTimers('new wheel open');
  window.wheel.clearFinishTimer('new wheel open');
  currentRunId += 1;
  window.wheel.setRunId(currentRunId);
  resetDragState();
  dropZone.classList.remove('fade-in', 'fade-out');
  dropZone.style.opacity = '';
  if (!changeState('wheelOpen', 'drag recognized')) return;
  activeCategory = category;
  setHover(true);
  dropZone.classList.add('expanded');
  const wheelContainer = document.getElementById('wheel-container');
  wheelContainer.classList.remove('fade-out');
  wheelContainer.style.opacity = '0';
  wheelContainer.style.transform = 'scale(0.96)';
  await window.api.expandWindow();
  if (state !== 'wheelOpen') return;
  await window.wheel.show(category, sourceExts, fileLabel, chooseFormat);
}

async function collapse() {
  if (state === 'done') {
    await resetAll('collapse from done');
    return;
  }
  dropZone.classList.remove('expanded');
  window.wheel.hide('collapse');
  if (state !== 'idle') {
    changeState('idle', 'drag left');
    await window.api.collapseWindow();
  }
}

function showMessage(message, duration = 1500) {
  clearTimer('message', 'new message');
  dropZone.classList.remove('expanded');
  dropZone.classList.add('message');
  window.wheel.hide('message');
  fileNameEl.textContent = message;
  fileCategoryEl.textContent = '';
  startTimer('message', duration, currentRunId, () => resetAll('message timeout'));
}

function delay(milliseconds, runId, name) {
  return waitForTimer(name, milliseconds, runId);
}

async function validateFiles(paths) {
  if (!paths.length) {
    console.log('file open early return: no files');
    return null;
  }

  const infos = await window.api.getFilesInfo(paths);
  console.log('getFilesInfo result:', JSON.stringify(infos));
  const categories = new Set(infos.map((info) => info.category));
  if (categories.size !== 1 || infos.some((info) => info.category === 'unsupported')) {
    if (infos.length === 1 && infos[0].category === 'unsupported') {
      console.log('file open early return: single unsupported file');
      showMessage('Unsupported file');
    } else {
      console.log('file open early return: mixed categories or unsupported files');
      showMessage('Drop one kind of file at a time.');
    }
    return null;
  }
  return infos;
}

function storePendingFiles(paths, infos) {
  pendingFiles = infos.map((info, index) => ({ info, filePath: paths[index] }));
  const category = infos[0].category;
  const label = infos.length === 1 ? infos[0].name : `${infos.length} ${category}s`;
  fileNameEl.textContent = label;
  fileCategoryEl.textContent = category;
  dropZone.classList.add('has-file');
  return { category, label };
}

async function openWheelWithFiles(paths) {
  if (conversionRunning) {
    console.log('files open early return: conversion running');
    return;
  }
  console.log('files open:', paths.length);
  resetDragState();
  if (state !== 'idle') await resetAll();
  const infos = await validateFiles(paths);
  if (!infos) return;
  const { category, label } = storePendingFiles(paths, infos);
  await expand(category, infos.map((info) => info.extension), label);
  if (state === 'wheelOpen') {
    window.wheel.highlight(0);
    console.log('files open complete: active wedge', window.wheel.outputs[0]);
  }
}

async function chooseFormat(format, index = -1) {
  if (state !== 'wheelOpen' || conversionRunning || !pendingFiles.length) {
    console.log('wedge chosen early return:', conversionRunning ? 'conversion running' : 'stale interaction');
    return;
  }

  const runId = ++currentRunId;
  if (dropStartedAt) {
    console.log('drop to converting view:', JSON.stringify({
      runId,
      durationMs: Math.round(performance.now() - dropStartedAt),
    }));
  }
  window.wheel.setRunId(runId);
  changeState('converting', 'format chosen');
  selectedFormat = format;
  console.log('wedge chosen:', index, format, 'runId:', runId);
  const category = pendingFiles[0].info.category;
  const files = pendingFiles.slice();
  conversionRunning = true;
  console.log('convert start:', files.length, format, 'runId:', runId);
  window.wheel.startProgress(files.length);
  const result = {
    count: files.length,
    saved: 0,
    skipped: 0,
    failed: 0,
    pages: 0,
    outputs: [],
    firstName: '',
    error: '',
  };

  try {
    for (let index = 0; index < files.length; index += 1) {
      if (runId !== currentRunId) return;
      const current = files[index];
      console.log('batch progress:', index + 1, 'of', files.length, current.info.name);
      try {
        const conversion = await window.api.convert(current.filePath, format);
        if (runId !== currentRunId) return;
        console.log('convert result:', JSON.stringify(conversion));
        if (conversion.skipped) {
          result.skipped += 1;
        } else if (conversion.ok) {
          result.saved += 1;
          if (Number.isInteger(conversion.pages)) result.pages += conversion.pages;
          result.outputs.push(conversion.outputPath);
          if (!result.firstName) result.firstName = conversion.outputPath.split(/[\\/]/).pop();
        } else {
          result.failed += 1;
          result.error = conversion.error;
        }
      } catch (error) {
        if (runId !== currentRunId) return;
        console.log('convert result:', error.message);
        result.failed += 1;
        result.error = 'Could not convert this file.';
      }
      window.wheel.updateProgress(index + 1, files.length, result.saved, result.failed);
    }

    if (result.failed === result.count) {
      window.wheel.finishProgress(true);
      await delay(600, runId, 'error-fill');
      if (runId !== currentRunId) return;
      window.wheel.showFinish(
        { error: result.error || 'Could not convert this file.' },
        () => resetAll('finish timer'),
        runId,
      );
    } else {
      window.wheel.finishProgress(false);
      await delay(200, runId, 'success-fill');
      if (runId !== currentRunId) return;
      window.wheel.showFinish({
        ...result,
        firstOutput: result.outputs[0],
      }, () => resetAll('finish timer'), runId);
    }
  } finally {
    if (runId !== currentRunId) return;
    conversionRunning = false;
    changeState('done', result.failed === result.count ? 'conversion error' : 'conversion finished');
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
  clearTimer('drag-leave', 'new dragenter');
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
    clearTimer('drag-leave', 'new dragleave');
    const dragRunId = currentRunId;
    startTimer('drag-leave', 150, dragRunId, () => {
      if (dragCount !== 0) return;
      resetDragState();
      fileNameEl.textContent = 'Drop file';
      if (state === 'wheelOpen' || state === 'armed') resetAll();
    });
  }
});

async function handleDrop(event, suppliedWedgeIndex = null) {
  preventDefaults(event);
  console.log('drop');
  dropStartedAt = performance.now();
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

  const infos = await validateFiles(paths);
  if (!infos) return;
  const { category, label } = storePendingFiles(paths, infos);

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
  document.body.dataset.state = state;
  logWindowMetrics('load');
  new ResizeObserver(() => logWindowMetrics('resize')).observe(document.documentElement);
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

window.api.onFilesOpen((paths) => openWheelWithFiles(paths));
window.api.onShortcutError((message) => {
  console.log('keyboard shortcut error:', message);
  showMessage(message);
});
window.api.onIntegrationMessage((message) => {
  console.log('integration result:', message);
  showMessage(message);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && (state === 'wheelOpen' || state === 'converting' || state === 'done')) {
    event.preventDefault();
    console.log('keyboard navigation: Escape');
    resetAll();
    return;
  }
  if (!isWheelOpen() || !window.wheel.outputs.length) return;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    const next = (window.wheel.selectedIndex + 1) % window.wheel.outputs.length;
    console.log('keyboard navigation: forward', next);
    window.wheel.highlight(next);
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = (window.wheel.selectedIndex - 1 + window.wheel.outputs.length) % window.wheel.outputs.length;
    console.log('keyboard navigation: back', next);
    window.wheel.highlight(next);
  }
  if (event.key === 'Enter' && window.wheel.selectedIndex >= 0) {
    event.preventDefault();
    console.log('keyboard navigation: Enter', window.wheel.selectedIndex);
    chooseFormat(window.wheel.outputs[window.wheel.selectedIndex], window.wheel.selectedIndex);
  }
});

quitButton.addEventListener('click', (event) => {
  event.stopPropagation();
  window.close();
});
