const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

const databaseUrl = process.env.DATABASE_URL?.trim();
if (
  !databaseUrl ||
  databaseUrl.includes('CHANGE_ME') ||
  databaseUrl.includes('YOUR_DATABASE_PASSWORD') ||
  databaseUrl.includes('YOUR_PROJECT_REF')
) {
  throw new Error(
    'Set DATABASE_URL to the PostgreSQL connection URI from Supabase Dashboard > Connect and replace its placeholders with your database password.',
  );
}

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  throw new Error('DATABASE_URL must be a valid PostgreSQL connection URI.');
}
if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
  throw new Error(
    'DATABASE_URL must be a PostgreSQL connection URI from Supabase Dashboard > Connect. ' +
      'The Supabase HTTPS project URL and publishable/secret API keys are not PostgreSQL credentials.',
  );
}

const caPath = process.env.SUPABASE_DB_CA_CERT?.trim();
let ssl = true;
if (caPath) {
  const resolvedCaPath = path.isAbsolute(caPath)
    ? caPath
    : path.resolve(__dirname, '..', caPath);
  let ca;
  try {
    ca = fs.readFileSync(resolvedCaPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Supabase CA certificate not found at "${resolvedCaPath}". Download it from Project Settings > Database > SSL Configuration.`,
      );
    }
    throw error;
  }
  if (!ca.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error(`Supabase CA certificate at "${resolvedCaPath}" is not a PEM certificate.`);
  }
  ssl = { ca, rejectUnauthorized: true };
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl,
  options: '-c role=boses_app',
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

module.exports = pool;
