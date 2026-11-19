const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const VALID_QUALITIES = ['small', 'balanced', 'best'];
const DEFAULT_QUALITY = 'balanced';
const VALID_SHORTCUTS = ['Ctrl+Alt+C', 'Ctrl+Alt+S', 'Ctrl+Alt+Space', 'Off'];
const DEFAULT_SHORTCUT = 'Ctrl+Alt+C';

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getQuality() {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return VALID_QUALITIES.includes(settings.quality) ? settings.quality : DEFAULT_QUALITY;
  } catch {
    return DEFAULT_QUALITY;
  }
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function getShortcut() {
  const shortcut = readSettings().shortcut;
  return VALID_SHORTCUTS.includes(shortcut) ? shortcut : DEFAULT_SHORTCUT;
}

function setShortcut(value) {
  if (!VALID_SHORTCUTS.includes(value)) return getShortcut();

  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify({
      ...readSettings(),
      shortcut: value,
    }, null, 2));
  } catch (error) {
    console.error('Could not save keyboard shortcut setting:', error);
  }
  return value;
}

function setQuality(value) {
  if (!VALID_QUALITIES.includes(value)) {
    return getQuality();
  }

  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify({
      ...readSettings(),
      quality: value,
    }, null, 2));
  } catch (error) {
    console.error('Could not save quality setting:', error);
  }
  return value;
}

module.exports = { getQuality, setQuality, getShortcut, setShortcut };
