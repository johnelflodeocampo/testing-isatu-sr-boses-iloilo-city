const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Vercel routes pages through Express without internal rewrites', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

  assert.equal(config.framework, 'express');
  assert.equal(config.functions, undefined);
  assert.equal(config.rewrites, undefined);
  for (const asset of [
    'public/favicon.ico',
    'public/assets/css/style.css',
    'public/assets/js/landing.js',
    'public/assets/assests/logo/isatu_logo.png',
  ]) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', asset)), `Missing Vercel asset: ${asset}`);
  }

  const favicon = fs.readFileSync(path.join(__dirname, '..', 'public', 'favicon.ico'));
  assert.deepEqual([...favicon.subarray(0, 4)], [0, 0, 1, 0]);
  assert.match(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'),
    /rel="icon" href="\/favicon\.ico" type="image\/x-icon"/,
  );
});
