const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('Vercel loads the bundled Supabase CA when configured with its project-relative path', () => {
  const root = path.join(__dirname, '..');
  const result = spawnSync(process.execPath, ['-e', `
    const crypto = require('node:crypto');
    const pool = require('./models/database');
    const bundledCa = require('./models/supabaseRootCa');
    const certificate = new crypto.X509Certificate(bundledCa);
    if (!pool.options.ssl || pool.options.ssl.ca !== bundledCa
      || !certificate.subject.includes('Supabase Root 2021 CA')) {
      throw new Error('The embedded Supabase CA was not loaded.');
    }
    if (pool.options.max !== 1 || pool.options.options !== '-c role=boses_app') {
      throw new Error('Vercel session-pooler defaults are incorrect.');
    }
    console.log('Embedded CA loaded.');
    pool.end();
  `], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: 'postgresql://user:password@localhost:5432/boses',
      SUPABASE_DB_CA_CERT: 'prod-ca-2021.crt',
      SUPABASE_DB_CA_CERT_CONTENT: '',
      VERCEL: '1',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Embedded CA loaded\./);
});

test('Vercel transaction-pooler mode uses one restricted connection without session role state', () => {
  const root = path.join(__dirname, '..');
  const result = spawnSync(process.execPath, ['-e', `
    const pool = require('./models/database');
    if (pool.options.max !== 1 || pool.options.options !== undefined) {
      throw new Error('Transaction-pooler settings are incorrect.');
    }
    console.log('Transaction-pooler settings loaded.');
    pool.end();
  `], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: 'postgresql://boses_app.projectref:password@aws-1-region.pooler.supabase.com:6543/postgres',
      DB_TRANSACTION_POOLER: 'true',
      SUPABASE_DB_CA_CERT: '',
      SUPABASE_DB_CA_CERT_CONTENT: '',
      VERCEL: '1',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Transaction-pooler settings loaded\./);
});

test('transaction-pooler mode rejects session-pooler connection strings', () => {
  const root = path.join(__dirname, '..');
  const result = spawnSync(process.execPath, ['-e', "require('./models/database')"], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: 'postgresql://boses_app.projectref:password@aws-1-region.pooler.supabase.com:5432/postgres',
      DB_TRANSACTION_POOLER: 'true',
      SUPABASE_DB_CA_CERT: '',
      SUPABASE_DB_CA_CERT_CONTENT: '',
      VERCEL: '1',
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DB_TRANSACTION_POOLER=true requires a Supabase transaction-pooler URI/);
});
