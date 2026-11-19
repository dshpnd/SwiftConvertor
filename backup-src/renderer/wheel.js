const wheelContainer = document.getElementById('wheel-container');
const SVG_NS = 'http://www.w3.org/2000/svg';

const wheel = {
  outputs: [],
  selectedIndex: -1,
  onChoose: null,
  finishTimer: null,
  finishRemaining: 4000,
  finishStarted: 0,
  quality: 'balanced',
  onDragOver: null,
  onDrop: null,
  svg: null,
  wedgeGroups: [],

  setDragHandlers(onDragOver, onDrop) {
    this.onDragOver = onDragOver;
    this.onDrop = onDrop;
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
    wheelContainer.setAttribute('aria-hidden', 'false');
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
    svg.appendChild(defs);

    const center = 220;
    const innerRadius = 94;
    const centerCircle = document.createElementNS(SVG_NS, 'circle');
    centerCircle.setAttribute('cx', center);
    centerCircle.setAttribute('cy', center);
    centerCircle.setAttribute('r', innerRadius - 8);
    centerCircle.classList.add('wheel-center');
    svg.appendChild(centerCircle);
    this.addCenterText(svg, 'Release to detect', categoryName);
    wheelContainer.appendChild(svg);
    this.svg = svg;
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
      const start = -Math.PI / 2 + index * angleSize + 0.02;
      const end = start + angleSize - 0.04;
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
      group.addEventListener('click', () => this.choose(index));
      this.svg.insertBefore(group, this.svg.querySelector('.wheel-center'));
      this.wedgeGroups.push(group);

      const labelPoint = polar(center, center, (outerRadius + innerRadius) / 2, (start + end) / 2);
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', labelPoint.x);
      label.setAttribute('y', labelPoint.y);
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

  showFinish(result, onDone) {
    clearTimeout(this.finishTimer);
    wheelContainer.querySelectorAll('.wheel-wedge').forEach((wedge) => wedge.classList.add('finish'));
    const center = wheelContainer.querySelector('.wheel-center');
    if (center) center.classList.add('finish');
    const svg = wheelContainer.querySelector('.wheel-svg');
    if (!svg) return;
    const oldText = svg.querySelectorAll('.wheel-file-name, .wheel-category, .wheel-quality');
    oldText.forEach((element) => element.remove());
    if (result.error) {
      this.addCenterText(svg, result.error, '');
    } else {
      const summary = result.count === 1 ? 'Saved' : `${result.saved} saved`;
      this.addCenterText(svg, summary, result.count === 1 ? truncate(result.firstName, 24) : [
        result.skipped ? `${result.skipped} skipped` : '',
        result.failed ? `${result.failed} failed` : '',
      ].filter(Boolean).join(' · '));
      const check = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      check.setAttribute('d', 'M 192 286 L 211 305 L 250 260');
      check.classList.add('wheel-check');
      svg.appendChild(check);
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

    const pause = () => {
      if (this.finishTimer) {
        clearTimeout(this.finishTimer);
        this.finishRemaining -= Date.now() - this.finishStarted;
        this.finishTimer = null;
      }
    };
    const resume = () => {
      if (!this.finishTimer && this.finishRemaining > 0) {
        this.finishStarted = Date.now();
        this.finishTimer = setTimeout(onDone, this.finishRemaining);
      }
    };
    wheelContainer.onmouseenter = pause;
    wheelContainer.onmouseleave = resume;
    resume();
  },

  hide(reason = 'unspecified') {
    console.log('wheel closed:', reason);
    clearTimeout(this.finishTimer);
    this.finishTimer = null;
    this.finishRemaining = 4000;
    wheelContainer.onmouseenter = null;
    wheelContainer.onmouseleave = null;
    wheelContainer.setAttribute('aria-hidden', 'true');
    this.outputs = [];
    this.selectedIndex = -1;
    this.clearActive();
  },

  setActive(index) {
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
    return Math.floor(angle / ((Math.PI * 2) / this.outputs.length));
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
