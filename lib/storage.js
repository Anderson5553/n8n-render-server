const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function filePath(name) {
  ensureDataDir();
  return path.join(dataDir, `${name}.json`);
}

function ensureCollection(name, fallback) {
  const p = filePath(name);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

function readCollection(name, fallback = []) {
  ensureCollection(name, fallback);
  const p = filePath(name);
  const raw = fs.readFileSync(p, 'utf8');
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeCollection(name, value) {
  ensureDataDir();
  const p = filePath(name);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function nextId(items) {
  if (!items.length) return 1;
  return Math.max(...items.map((x) => Number(x.id) || 0)) + 1;
}

module.exports = {
  ensureCollection,
  readCollection,
  writeCollection,
  nextId
};
