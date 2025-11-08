const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.WEBGAL_RUNTIME_LOG_DIR
  ? path.resolve(process.cwd(), process.env.WEBGAL_RUNTIME_LOG_DIR)
  : path.resolve(process.cwd(), 'logs');
const CONSOLE_PREVIEW_LENGTH = Number(process.env.WEBGAL_RUNTIME_LOG_PREVIEW ?? 200);
const APPEND_MODE = process.env.WEBGAL_RUNTIME_LOG_APPEND === 'true';
let logFileInitialized = false;

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function initializeLogFile() {
  if (logFileInitialized || APPEND_MODE) {
    logFileInitialized = true;
    return;
  }
  const file = getLogFile();
  if (fs.existsSync(file)) {
    fs.writeFileSync(file, '', 'utf-8');
  }
  logFileInitialized = true;
}

function getLogFile() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return path.join(LOG_DIR, `runtime-${date}.log`);
}

function formatPreview(text) {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= CONSOLE_PREVIEW_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, CONSOLE_PREVIEW_LENGTH)}…`;
}

function appendLog(content) {
  try {
    initializeLogFile();
    fs.appendFileSync(getLogFile(), `\n${content}\n`, 'utf-8');
  } catch (err) {
    console.error('[runtime] failed to write log file', err);
  }
}

function logRequest(gameSlug, sliceId, { model, systemPrompt, userPrompt }) {
  const header = `[${new Date().toISOString()}] REQUEST ${gameSlug}/${sliceId} (model=${model})`;
  appendLog(`${header}\n[system]\n${systemPrompt.trim()}\n[user]\n${userPrompt.trim()}`);
}

function logSlice(gameSlug, sliceId, text) {
  const totalLength = text?.length ?? 0;
  const preview = formatPreview(text);
  console.info(`[runtime] script ${gameSlug}/${sliceId} (${totalLength} chars) preview: ${preview}`);

  if (!text) return;

  const logLine = `[${new Date().toISOString()}] RESPONSE ${gameSlug}/${sliceId} (${totalLength} chars)\n${text.trim()}`;
  appendLog(logLine);
}

module.exports = {
  logSlice,
  logRequest,
};
