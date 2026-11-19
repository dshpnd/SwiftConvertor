const wheelContainer = document.getElementById('wheel-container');
const SVG_NS = 'http://www.w3.org/2000/svg';

const wheel = {
  outputs: [],
  selectedIndex: -1,
  onChoose: null,
  quality: 'balanced',
  onDragOver: null,
  onDrop: null,
  svg: null,
  wedgeGroups: [],
  finishTimer: null,
  finishTimerRunId: 0,
  finishTimerDelay: 0,
  finishExtensionUsed: false,
  currentRunId: 0,
  lastWedgeIndex: -1,

  setDragHandlers(onDragOver, onDrop) {
    this.onDragOver = onDragOver;
    this.onDrop = onDrop;
  },

  setRunId(runId) {
    this.currentRunId = runId;
  },

  clearFinishTimer(reason = 'unspecified') {
    if (!this.finishTimer) return;
    clearTimeout(this.finishTimer);
    console.log('timer clear:', JSON.stringify({
      name: 'finish', delay: this.finishTimerDelay, runId: this.finishTimerRunId, reason,
    }));
    this.finishTimer = null;
  },

  startFinishTimer(onDone, runId, delay) {
    this.clearFinishTimer('replace');
    this.finishTimerRunId = runId;
    this.finishTimerDelay = delay;
    console.log('timer start:', JSON.stringify({ name: 'finish', delay, runId }));
    this.finishTimer = setTimeout(() => {
      this.finishTimer = null;
      console.log('timer fire:', JSON.stringify({ name: 'finish', delay, runId }));
      if (runId !== this.currentRunId) return;
      onDone();
    }, delay);
  },

  async show(category, sourceExts, fileLabel, onChoose) {
    const categoryName = category.toUpperCase();
    const extensions = Array.isArray(sourceExts) ? sourceExts : [sourceExts];
    this.outputs = await window.api.getOutputsForMany(category, extensions);
    this.selectedIndex = -1;
    this.onChoose = onChoose;
    this.quality = await window.api.getQuality();
    this.build(categoryName);
    this.updateWedges();
    this.updateCenterText(fileLabel || 'Release to detect', categoryName);
    this.lastWedgeIndex = -1;
    wheelContainer.classList.remove('fade-out');
    wheelContainer.style.transform = 'scale(0.96)';
    wheelContainer.style.opacity = '0';
    wheelContainer.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      wheelContainer.style.opacity = '';
      wheelContainer.style.transform = '';
    });
    console.log('wheel opened:', category, fileLabel);
  },

  build(categoryName) {
    if (this.svg) return;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 440 440');
    svg.classList.add('wheel-svg');
    const defs = document.createElementNS(SVG_NS, 'defs');
    const gradient = document.createElementNS(SVG_NS, 'linearGradient');
    gradient.id = 'wheel-gradient';
    gradient.innerHTML = '<stop offset="0%" stop-color="#757F9A"/><stop offset="51%" stop-color="#D7DDE8"/><stop offset="100%" stop-color="#757F9A"/>';
    defs.appendChild(gradient);
    const progressGradient = document.createElementNS(SVG_NS, 'linearGradient');
    progressGradient.id = 'wheel-progress-gradient';
    progressGradient.innerHTML = '<stop offset="0%" stop-color="#757F9A"/><stop offset="100%" stop-color="#D7DDE8"/>';
    defs.appendChild(progressGradient);
    svg.appendChild(defs);

    const center = 220;
    const innerRadius = 94;
    const centerCircle = document.createElementNS(SVG_NS, 'circle');
    centerCircle.setAttribute('cx', center);
    centerCircle.setAttribute('cy', center);
    centerCircle.setAttribute('r', innerRadius - 8);
    centerCircle.classList.add('wheel-center');
    svg.appendChild(centerCircle);
    this.addProgressRing(svg, center);
    this.addCenterText(svg, 'Release to detect', categoryName);
    wheelContainer.appendChild(svg);
    this.svg = svg;
    svg.addEventListener('click', (event) => {
      const index = this.wedgeIndexFromEvent(event);
      console.log('wheel click wedge:', index);
      if (index >= 0 && index < this.outputs.length) this.choose(index);
    });
  },

  addProgressRing(svg, center) {
    const circumference = 2 * Math.PI * 90;
    const track = document.createElementNS(SVG_NS, 'circle');
    track.setAttribute('cx', center);
    track.setAttribute('cy', center);
    track.setAttribute('r', '90');
    track.classList.add('progress-ring-track');

    const progress = document.createElementNS(SVG_NS, 'circle');
    progress.setAttribute('cx', center);
    progress.setAttribute('cy', center);
    progress.setAttribute('r', '90');
    progress.style.setProperty('--progress-circumference', circumference);
    progress.classList.add('progress-ring-progress');

    svg.append(track, progress);
    this.addProgressText(svg);
  },

  addProgressText(svg) {
    const count = document.createElementNS(SVG_NS, 'text');
    count.setAttribute('x', '220');
    count.setAttribute('y', '216');
    count.classList.add('progress-count');
    svg.appendChild(count);

    const caption = document.createElementNS(SVG_NS, 'text');
    caption.setAttribute('x', '220');
    caption.setAttribute('y', '238');
    caption.classList.add('progress-caption');
    caption.textContent = 'Converting';
    svg.appendChild(caption);
  },

  startProgress(totalFiles) {
    const progress = this.svg.querySelector('.progress-ring-progress');
    const count = this.svg.querySelector('.progress-count');
    if (!progress || !count) return;
    this.svg.classList.toggle('progress-indeterminate', totalFiles === 1);
    progress.classList.remove('progress-error');
    progress.style.setProperty('--progress-circumference', 2 * Math.PI * 90);
    progress.style.strokeDashoffset = totalFiles === 1 ? 2 * Math.PI * 90 * 0.75 : 2 * Math.PI * 90;
    count.textContent = totalFiles === 1 ? '' : `0/${totalFiles}`;
  },

  updateProgress(completedFiles, totalFiles, saved, failed) {
    const progress = this.svg.querySelector('.progress-ring-progress');
    const count = this.svg.querySelector('.progress-count');
    if (!progress || !count) return;
    if (totalFiles > 1) {
      const circumference = 2 * Math.PI * 90;
      progress.style.transitionDuration = completedFiles === totalFiles ? '0.2s' : '0.3s';
      progress.style.strokeDashoffset = circumference * (1 - completedFiles / totalFiles);
      count.textContent = `${completedFiles}/${totalFiles}`;
    }
    console.log('batch counts:', JSON.stringify({ completed: completedFiles, total: totalFiles, saved, failed }));
  },

  finishProgress(isError) {
    const progress = this.svg.querySelector('.progress-ring-progress');
    if (!progress) return;
    this.svg.classList.remove('progress-indeterminate');
    if (isError) {
      progress.classList.add('progress-error');
      return;
    }
    progress.style.transitionDuration = '0.2s';
    progress.style.strokeDashoffset = 0;
  },

  updateWedges() {
    const center = 220;
    const outerRadius = 190;
    const innerRadius = 94;
    const angleSize = (Math.PI * 2) / this.outputs.length;
    this.wedgeGroups.forEach((group) => group.remove());
    this.wedgeGroups = [];
    this.svg.querySelectorAll('.wheel-label').forEach((label) => label.remove());
    this.svg.querySelectorAll('.wheel-check').forEach((check) => check.remove());
    this.svg.querySelector('.wheel-center').classList.remove('finish');
    wheelContainer.querySelectorAll('.show-folder-button').forEach((button) => button.remove());

    this.outputs.forEach((format, index) => {
      const gapRadians = 0.02;
      const start = -Math.PI / 2 + index * angleSize + gapRadians / 2;
      const end = -Math.PI / 2 + (index + 1) * angleSize - gapRadians / 2;
      const group = document.createElementNS(SVG_NS, 'g');
      group.dataset.index = index;
      group.classList.add('wheel-wedge');
      const d = ringPath(center, outerRadius, innerRadius, start, end);
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.classList.add('wheel-wedge-gradient');
      const outline = document.createElementNS(SVG_NS, 'path');
      outline.setAttribute('d', d);
      outline.classList.add('wheel-wedge-outline');
      group.append(path, outline);
      this.svg.insertBefore(group, this.svg.querySelector('.wheel-center'));
      this.wedgeGroups.push(group);

      const labelPoint = polar(center, center, (outerRadius + innerRadius) / 2, (start + end) / 2);
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(Math.round(labelPoint.x)));
      label.setAttribute('y', String(Math.round(labelPoint.y)));
      label.classList.add('wheel-label');
      label.textContent = format.toUpperCase();
      this.svg.insertBefore(label, this.svg.querySelector('.wheel-center'));
    });
  },

  updateCenterText(fileLabel, categoryName) {
    this.svg.querySelectorAll('.wheel-file-name, .wheel-category, .wheel-quality').forEach((element) => element.remove());
    this.addCenterText(this.svg, fileLabel, categoryName);
  },

  addCenterText(svg, fileLabel, categoryName) {
    const name = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    name.setAttribute('x', '220');
    name.setAttribute('y', '215');
    name.classList.add('wheel-file-name');
    name.textContent = truncate(fileLabel, 24);
    svg.appendChild(name);
    const type = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    type.setAttribute('x', '220');
    type.setAttribute('y', '235');
    type.classList.add('wheel-category');
    type.textContent = categoryName;
    svg.appendChild(type);
    const quality = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    quality.setAttribute('x', '220');
    quality.setAttribute('y', '253');
    quality.classList.add('wheel-quality');
    quality.textContent = this.quality;
    svg.appendChild(quality);
  },

  showCenterMessage(message) {
    const name = wheelContainer.querySelector('.wheel-file-name');
    const type = wheelContainer.querySelector('.wheel-category');
    if (name) name.textContent = truncate(message, 28);
    if (type) type.textContent = '';
  },

  showFinish(result, onDone, runId) {
    this.clearFinishTimer('show finish');
    this.finishExtensionUsed = false;
    const oldText = this.svg.querySelectorAll('.wheel-file-name, .wheel-category, .wheel-quality, .wheel-label');
    oldText.forEach((element) => {
      element.style.transition = 'opacity 180ms cubic-bezier(0.22, 1, 0.36, 1)';
      element.style.opacity = '0';
    });
    wheelContainer.querySelectorAll('.wheel-wedge').forEach((wedge) => {
      wedge.classList.add('finish');
    });
    const center = wheelContainer.querySelector('.wheel-center');
    if (center) center.classList.add('finish');
    const svg = wheelContainer.querySelector('.wheel-svg');
    if (!svg) return;
    setTimeout(() => {
      if (runId !== this.currentRunId) return;
      wheelContainer.classList.remove('fade-out');
      const oldText = svg.querySelectorAll('.wheel-file-name, .wheel-category, .wheel-quality');
      oldText.forEach((element) => element.remove());
      if (result.error) {
        this.addCenterText(svg, result.error, '');
      } else {
        const summary = result.pages
          ? `Saved ${result.pages} ${result.pages === 1 ? 'page' : 'pages'}`
          : result.count === 1 ? 'Saved' : `${result.saved} saved`;
        this.addCenterText(svg, summary, result.count === 1 ? truncate(result.firstName, 24) : [
          result.skipped ? `${result.skipped} skipped` : '',
          result.failed ? `${result.failed} failed` : '',
        ].filter(Boolean).join(' · '));
        const check = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        check.setAttribute('d', 'M 192 286 L 211 305 L 250 260');
        check.classList.add('wheel-check');
        svg.appendChild(check);
        requestAnimationFrame(() => check.classList.add('finish-drawn'));
        if (result.firstOutput) {
          const button = document.createElement('button');
          button.className = 'show-folder-button';
          button.textContent = 'Show in folder';
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            window.api.showInFolder(result.firstOutput);
          });
          wheelContainer.appendChild(button);
        }
      }
      const holdMs = result.error ? 3000 : 2500;
      console.log('finish crossfade:', JSON.stringify({ runId, crossfadeMs: 180, holdMs }));
      this.startFinishTimer(onDone, runId, holdMs);
    }, 180);
  },

  hide(reason = 'unspecified') {
    console.log('wheel closed:', reason);
    this.clearFinishTimer(`hide: ${reason}`);
    this.finishExtensionUsed = false;
    wheelContainer.setAttribute('aria-hidden', 'true');
    wheelContainer.className = 'wheel-container';
    wheelContainer.style.cssText = '';
    wheelContainer.querySelectorAll('.wheel-wedge, .wheel-label, .wheel-check').forEach((element) => {
      element.classList.remove('active', 'selected', 'finish');
    });
    const center = wheelContainer.querySelector('.wheel-center');
    if (center) center.classList.remove('finish');
    wheelContainer.querySelectorAll('.show-folder-button').forEach((button) => button.remove());
    this.onChoose = null;
    this.outputs = [];
    this.selectedIndex = -1;
    this.clearActive();
  },

  setActive(index) {
    if (index >= 0 && index !== this.lastWedgeIndex) this.lastWedgeIndex = index;
    this.wedgeGroups.forEach((wedge, wedgeIndex) => {
      wedge.classList.toggle('active', wedgeIndex === index);
    });
  },

  clearActive() {
    this.wedgeGroups.forEach((wedge) => wedge.classList.remove('active'));
  },

  highlight(index) {
    this.selectedIndex = index;
    this.setActive(index);
    this.wedgeGroups.forEach((wedge, wedgeIndex) => {
      wedge.classList.toggle('selected', wedgeIndex === index);
    });
  },

  choose(index) {
    if (this.outputs[index] && this.onChoose) this.onChoose(this.outputs[index], index);
  },

  wedgeIndexFromEvent(event) {
    if (!this.outputs.length) return -1;
    const bounds = wheelContainer.getBoundingClientRect();
    const scaleX = 440 / bounds.width;
    const scaleY = 440 / bounds.height;
    const x = (event.clientX - bounds.left) * scaleX - 220;
    const y = (event.clientY - bounds.top) * scaleY - 220;
    const radius = Math.sqrt((x * x) + (y * y));
    if (radius < 86 || radius > 190) return -1;
    let angle = Math.atan2(y, x) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    const angleSize = (Math.PI * 2) / this.outputs.length;
    const rawIndex = angle / angleSize;
    let index = Math.floor(rawIndex);
    if (index >= this.outputs.length) index = 0;
    const withinWedge = rawIndex - index;
    const hysteresis = 2 / 360;
    if (this.lastWedgeIndex >= 0 && index !== this.lastWedgeIndex
      && (withinWedge < hysteresis || withinWedge > 1 - hysteresis)) {
      return this.lastWedgeIndex;
    }
    return index;
  },
};

wheelContainer.addEventListener('drop', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  console.log('drop target:', event.target.tagName, event.target.className);
  const wedgeIndex = wheel.wedgeIndexFromEvent(event);
  if (wheel.onDrop) wheel.onDrop(event, wedgeIndex);
});

function polar(cx, cy, radius, angle) {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

function ringPath(cx, outerRadius, innerRadius, start, end) {
  const outerStart = polar(cx, cx, outerRadius, start);
  const outerEnd = polar(cx, cx, outerRadius, end);
  const innerStart = polar(cx, cx, innerRadius, start);
  const innerEnd = polar(cx, cx, innerRadius, end);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 0 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function truncate(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

window.wheel = wheel;
