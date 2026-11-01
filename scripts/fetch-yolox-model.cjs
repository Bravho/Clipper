#!/usr/bin/env node
/**
 * Fetch or verify the YOLOX-nano ONNX model.
 *
 * Usage:
 *   node scripts/fetch-yolox-model.cjs           # download if missing, then verify
 *   node scripts/fetch-yolox-model.cjs --verify  # verify only, error if missing
 *
 * Rules:
 *   - If the model file exists, only verify SHA256 (never overwrite).
 *   - If missing (and not --verify), download from the official Megvii release URL.
 *   - Exit non-zero on SHA256 mismatch or download failure.
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODEL_URL =
  'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx';
const EXPECTED_SHA256 = 'c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d';
const EXPECTED_SIZE = 3_659_407;
const MODEL_PATH = path.join(__dirname, '..', 'models', 'yolox', 'yolox_nano.onnx');

const verifyOnly = process.argv.includes('--verify');

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function verify(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size !== EXPECTED_SIZE) {
    console.error(`Size mismatch: expected ${EXPECTED_SIZE}, got ${stat.size}`);
    process.exit(1);
  }
  const hash = sha256File(filePath);
  if (hash !== EXPECTED_SHA256) {
    console.error(`SHA256 mismatch:\n  expected: ${EXPECTED_SHA256}\n  got:      ${hash}`);
    process.exit(1);
  }
  console.log(`SHA256 OK: ${hash}`);
}

function download(url, dest, redirects) {
  if (redirects === undefined) redirects = 0;
  if (redirects > 5) {
    console.error('Too many redirects.');
    process.exit(1);
  }
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'fetch-yolox-model/1.0' } }, function(res) {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      const tmp = dest + '.tmp';
      const out = fs.createWriteStream(tmp);
      let received = 0;
      res.on('data', function(chunk) {
        received += chunk.length;
        process.stdout.write('\r  ' + (received / 1024 / 1024).toFixed(1) + ' MB received');
      });
      res.pipe(out);
      out.on('finish', function() {
        process.stdout.write('\n');
        out.close(function() {
          fs.renameSync(tmp, dest);
          resolve();
        });
      });
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const dir = path.dirname(MODEL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(MODEL_PATH)) {
    console.log('Model already present at', MODEL_PATH);
    console.log('Verifying SHA256...');
    verify(MODEL_PATH);
    return;
  }

  if (verifyOnly) {
    console.error('Model not found at', MODEL_PATH, '(use --verify only when file exists)');
    process.exit(1);
  }

  console.log('Downloading YOLOX-nano ONNX from Megvii release 0.1.1rc0...');
  console.log(' ', MODEL_URL);
  await download(MODEL_URL, MODEL_PATH);
  console.log('Download complete. Verifying SHA256...');
  verify(MODEL_PATH);
  console.log('Model saved to', MODEL_PATH);
}

main().catch(function(err) {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
