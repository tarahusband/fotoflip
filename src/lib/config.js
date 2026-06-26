const path = require('path');
const fsSyncModule = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const UPLOAD_DIR    = path.join(ROOT, 'uploads');
const PROCESSED_DIR = path.join(ROOT, 'processed');
const LOG_DIR       = process.env.DATA_DIR || ROOT;
const ERROR_LOG     = path.join(LOG_DIR, 'error.log');

function logError(context, err) {
  const line = `[${new Date().toISOString()}] ${context}: ${err?.message || err}\n`;
  console.error(line.trim());
  fsSyncModule.appendFileSync(ERROR_LOG, line);
}

module.exports = { UPLOAD_DIR, PROCESSED_DIR, LOG_DIR, ERROR_LOG, logError, fsSyncModule };
