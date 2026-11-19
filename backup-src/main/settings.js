const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const VALID_QUALITIES = ['small', 'balanced', 'best'];
const DEFAULT_QUALITY = 'balanced';

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

function setQuality(value) {
  if (!VALID_QUALITIES.includes(value)) {
    return getQuality();
  }

  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify({ quality: value }, null, 2));
  } catch (error) {
    console.error('Could not save quality setting:', error);
  }
  return value;
}

module.exports = { getQuality, setQuality };
