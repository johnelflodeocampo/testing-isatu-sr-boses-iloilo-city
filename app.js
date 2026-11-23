const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const createGasApiClient = require('./utils/gasApi');
const createLoginOtp = require('./utils/loginOtp');
const createPostgresRateLimitStore = require('./utils/postgresRateLimitStore');
const createPrivacyNoticeStore = require('./lib/postgresPrivacyNoticeStore');
const {
  normalizeEmail: normalizeIsatuEmail,
  normalizeOfficerEmail,
  normalizeStudentEmail,
} = require('./utils/isatuEmail');

const app = express();
const port = Number(process.env.PORT || 3000);
const vercelHost = process.env.VERCEL_URL?.trim();
const configuredAppUrl = process.env.APP_URL?.trim();
const appUrl = new URL(
  configuredAppUrl || (vercelHost ? `https://${vercelHost}` : `http://localhost:${port}`),
);
const sessionCookie = 'boses_user_session';
const sessionDurationSeconds = 8 * 60 * 60;
const privateDirectory = path.join(__dirname, 'private');
const isLocalApp = ['localhost', '127.0.0.1', '::1'].includes(appUrl.hostname);
const allowedOrigins = new Set([appUrl.origin]);
const secureCookies = appUrl.protocol === 'https:';
const sessionCookieOptions = {
  httpOnly: true,
  secure: secureCookies,
  sameSite: 'strict',
  path: '/',
};
const errorPageTemplate = fs.readFileSync(
  path.join(privateDirectory, 'pages', 'errors', 'error.html'),
  'utf8',
);
const pool = require('./models/database');
const reportModel = require('./models/reportModel')(pool);
const draftModel = require('./models/draftModel')(pool);
const privacyNoticeStore = createPrivacyNoticeStore(pool);

if (appUrl.protocol !== 'https:' && !isLocalApp) {
  throw new Error('APP_URL must use HTTPS except for localhost development.');
}
if (process.env.NODE_ENV === 'production' && isLocalApp) {
  throw new Error('Set APP_URL or deploy to Vercel with VERCEL_URL before running in production.');
}
for (const deploymentHost of [
  process.env.VERCEL_URL,
  process.env.VERCEL_BRANCH_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
]) {
  if (deploymentHost && /^[a-z0-9.-]+$/i.test(deploymentHost)) {
    allowedOrigins.add(`https://${deploymentHost}`);
  }
}

for (const name of ['JWT_SECRET', 'HASH_PEPPER']) {
  if (!process.env[name] || process.env[name].startsWith('CHANGE_ME')
    || process.env[name].length < 32) {
    throw new Error(`Set ${name} to a unique random value of at least 32 characters.`);
  }
}

const gasApi = createGasApiClient(pool);
if (process.env.NODE_ENV === 'production') gasApi.validateConfiguration();
const loginOtp = createLoginOtp({
  pool,
  secret: process.env.JWT_SECRET,
  sendEmail: gasApi.sendLoginOtp,
});

app.disable('x-powered-by');
if (process.env.VERCEL) app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use((request, response, next) => {
  const startedAt = Date.now();
  response.on('finish', () => {
    const routePath = request.route?.path;
    const route = typeof routePath === 'string'
      ? `${request.baseUrl}${routePath}`
      : request.path.startsWith('/assets/') ? 'static' : 'unmatched';
    const status = response.statusCode;
    const log = JSON.stringify({
      event: 'http_request',
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      method: request.method,
      route,
      status,
      durationMs: Date.now() - startedAt,
    });
    if (status >= 500) console.error(log);
    else console.log(log);
  });
  next();
});
app.use(express.json({ limit: '64kb' }));
app.use('/assets', express.static(path.join(__dirname, 'public'), {
  fallthrough: false,
  index: false,
  maxAge: 0,
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait and try again.' },
  store: createPostgresRateLimitStore(pool, process.env.HASH_PEPPER, 'api'),
});
const trackerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many tracking lookups. Please wait before trying again.' },
  store: createPostgresRateLimitStore(pool, process.env.HASH_PEPPER, 'tracker'),
});
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many code requests. Wait before requesting another code.' },
  store: createPostgresRateLimitStore(pool, process.env.HASH_PEPPER, 'otp-request'),
});
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many code attempts. Wait before trying again.' },
  store: createPostgresRateLimitStore(pool, process.env.HASH_PEPPER, 'otp-verify'),
});
const submissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Submission limit reached. Please try again later.' },
  store: createPostgresRateLimitStore(pool, process.env.HASH_PEPPER, 'submission'),
});
const messageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many messages. Please wait before sending more.' },
  store: createPostgresRateLimitStore(pool, process.env.HASH_PEPPER, 'message'),
});

app.use('/api', apiLimiter);
app.use('/api/tracker', trackerLimiter);

function sendPrivatePage(fileName, response) {
  response.set({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  response.sendFile(path.join(privateDirectory, fileName));
}

function sendPrivateScript(fileName, response) {
  response.set({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  response.type('application/javascript');
  response.sendFile(path.join(privateDirectory, fileName));
}

function normalizeEmail(value) {
  return normalizeIsatuEmail(value);
}

function getIdentityTag(email) {
  return crypto
    .createHash('sha256')
    .update(`${email}:${process.env.HASH_PEPPER}`)
    .digest('hex');
}

function getLegacyIdentityTag(email) {
  const digest = crypto
    .createHash('sha256')
    .update(`${email}:${process.env.HASH_PEPPER}`)
    .digest('hex');
  const domain = email.slice(email.lastIndexOf('@'));
  return `${digest.slice(0, 12)}...${digest.slice(-4)}${domain}`;
}

async function isIdentityBanned(email) {
  const result = await pool.query(
    'SELECT 1 FROM public.banned_identities WHERE identity_hash = ANY($1::text[])',
    [[getIdentityTag(email), getLegacyIdentityTag(email)]],
  );
  return result.rowCount > 0;
}

function setSession(response, email, role) {
  const token = jwt.sign({ email, role }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: sessionDurationSeconds,
    issuer: 'isatu-boses',
    audience: 'isatu-boses-browser',
  });
  response.cookie(sessionCookie, token, {
    ...sessionCookieOptions,
    maxAge: sessionDurationSeconds * 1000,
  });
}

function clearSession(response) {
  response.clearCookie(sessionCookie, sessionCookieOptions);
}

function readSession(request) {
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`))
    ?.slice(sessionCookie.length + 1);
  if (!cookie) return null;

  try {
    return jwt.verify(cookie, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'isatu-boses',
      audience: 'isatu-boses-browser',
    });
  } catch {
    return null;
  }
}

function isAdminRole(role) {
  return role === 'admin' || role === 'superadmin';
}

function matchesRequiredRole(sessionRole, requiredRole) {
  if (!requiredRole) return sessionRole === 'user' || isAdminRole(sessionRole);
  if (requiredRole === 'member') return sessionRole === 'user';
  if (requiredRole === 'officer') return isAdminRole(sessionRole);
  return sessionRole === requiredRole;
}

async function validateAdminSession(session, response, redirectPath) {
  const result = await pool.query(
    'SELECT role FROM public.admins WHERE email = $1',
    [session.email],
  );
  if (result.rowCount === 0 || result.rows[0].role !== session.role) {
    clearSession(response);
    if (redirectPath) {
      response.redirect(303, redirectPath);
    } else {
      response.status(403).json({ error: 'Officer access has been removed or changed. Sign in again.' });
    }
    return false;
  }
  return true;
}

function requireSession(role) {
  return async (request, response, next) => {
    const session = readSession(request);
    if (!session || !matchesRequiredRole(session.role, role)) {
      return response.status(401).json({ error: 'Please sign in to continue.' });
    }
    if (isAdminRole(session.role)) {
      try {
        if (!(await validateAdminSession(session, response))) return;
      } catch (error) {
        return next(error);
      }
    }
    if (session.role === 'user') {
      try {
        if (await isIdentityBanned(session.email)) {
          clearSession(response);
          return response.status(403).json({ error: 'This account has been blocked from member access.' });
        }
      } catch (error) {
        return next(error);
      }
    }
    request.session = session;
    next();
  };
}

function requireApiSession(request, response, next) {
  const session = readSession(request);
  if (!session) {
    return response.status(401).json({ error: 'Please sign in to continue.' });
  }
  request.session = session;
  next();
}

function requirePageSession(role, signInPath) {
  return async (request, response, next) => {
    const session = readSession(request);
    if (!session || !matchesRequiredRole(session.role, role)) {
      return response.redirect(303, signInPath);
    }
    if (isAdminRole(session.role)) {
      try {
        if (!(await validateAdminSession(session, response, signInPath))) return;
      } catch (error) {
        return next(error);
      }
    }
    if (session.role === 'user') {
      try {
        if (await isIdentityBanned(session.email)) {
          clearSession(response);
          return response.redirect(303, signInPath);
        }
      } catch (error) {
        return next(error);
      }
    }
    request.session = session;
    next();
  };
}

function requireBrowserRequest(request, response, next) {
  if (request.get('X-Requested-With') !== 'BOSES-Client') {
    return response.status(403).json({ error: 'This request is not allowed.' });
  }
  if (request.get('Origin') && !allowedOrigins.has(request.get('Origin'))) {
    return response.status(403).json({ error: 'Request origin is not allowed.' });
  }
  next();
}

function enforceApiAccess(request, response, next) {
  const publicReadOnlyRoute = request.method === 'GET'
    && (
      request.path === '/resources'
      || /^\/tracker\/[^/]+$/i.test(request.path)
    );
  const publicOtpRoute = request.method === 'POST'
    && ['/auth/otp/request', '/auth/otp/verify'].includes(request.path);
  if (publicReadOnlyRoute || publicOtpRoute) return next();
  return requireApiSession(request, response, next);
}

function handleDatabaseError(error, response) {
  if (error.code === '23505') {
    if (error.constraint === 'admins_pkey') {
      return response.status(409).json({ error: 'This email already has officer access.' });
    }
    return response.status(409).json({ error: 'That tracking ID is already in use. Please retry.' });
  }
  if (error.code === '23514' && /last superadmin/i.test(error.message)) {
    return response.status(409).json({ error: error.message });
  }
  if (error.code === '23514' || error.code === '22001' || error.code === '22P02') {
    return response.status(400).json({ error: 'Some submitted information is invalid.' });
  }
  if (error.code === '42501') {
    return response.status(403).json({ error: 'You are not authorized to perform this action.' });
  }
  if (error.code === 'P0002') {
    return response.status(404).json({ error: 'Report not found.' });
  }
  console.error('Database operation failed:', error.message);
  return response.status(500).json({ error: 'A database error prevented this request.' });
}

app.use('/api', enforceApiAccess);
app.use(require('./routes')({
  path,
  crypto,
  appUrl,
  publicDirectory: path.join(__dirname, 'public'),
  privateDirectory,
  privacyNoticeStore,
  sendPrivatePage,
  sendPrivateScript,
  pool,
  reportModel,
  draftModel,
  gasApi,
  loginOtp,
  normalizeEmail,
  normalizeOfficerEmail,
  normalizeStudentEmail,
  getIdentityTag,
  isIdentityBanned,
  setSession,
  clearSession,
  readSession,
  isAdminRole,
  validateAdminSession,
  requireSession,
  requirePageSession,
  requireBrowserRequest,
  handleDatabaseError,
  otpRequestLimiter,
  otpVerifyLimiter,
  submissionLimiter,
  messageLimiter,
  sessionCookie,
  sessionCookieOptions,
  secureCookies,
}));

const errorDetails = {
  400: { title: 'Bad request', message: 'We could not understand that request. Check the address or try again.' },
  401: { title: 'Sign in required', message: 'You may need to sign in before you can view this page.' },
  403: { title: 'Access denied', message: 'You do not have permission to view this page.' },
  404: { title: 'Page not found', message: 'The page may have moved, or the address may be incorrect.' },
  405: { title: 'Method not allowed', message: 'That action is not available here.' },
  408: { title: 'Request timed out', message: 'The request took too long. Please try again.' },
  413: { title: 'Request too large', message: 'The submitted request exceeds the allowed size.' },
  429: { title: 'Too many requests', message: 'Please wait a moment before trying again.' },
  500: { title: 'Something went wrong', message: 'An unexpected error occurred. Please try again later.' },
  502: { title: 'Service unavailable', message: 'The service could not complete your request. Please try again later.' },
  503: { title: 'Temporarily unavailable', message: 'The service is temporarily unavailable. Please try again later.' },
  504: { title: 'Request timed out', message: 'The service took too long to respond. Please try again later.' },
};

function sendErrorPage(response, status) {
  const details = errorDetails[status] || (status >= 500
    ? errorDetails[500]
    : { title: 'Request could not be completed', message: 'Please check the address and try again.' });
  return response
    .status(status)
    .set({
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
    .type('html')
    .send(
      errorPageTemplate
        .replaceAll('<!-- ERROR_STATUS -->', String(status))
        .replaceAll('<!-- ERROR_TITLE -->', details.title)
        .replaceAll('<!-- ERROR_MESSAGE -->', details.message),
    );
}

app.use((request, response) => {
  const requestPath = request.path.toLowerCase();
  if (requestPath === '/api' || requestPath.startsWith('/api/')) {
    return response.status(404).json({ error: 'The requested API endpoint was not found.' });
  }
  return sendErrorPage(response, 404);
});

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  const status = error.type === 'entity.too.large'
    ? 413
    : Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : 500;
  if (status >= 500) console.error('Request failed:', error.message);
  const requestPath = request.path.toLowerCase();
  if (requestPath === '/api' || requestPath.startsWith('/api/')) {
    const message = status === 413
      ? 'Request body is too large.'
      : 'The request could not be completed.';
    return response.status(status).json({ error: message });
  }
  return sendErrorPage(response, status);
});

async function start() {
  await pool.query('SELECT 1');
  app.listen(port, () => {
    console.log(`ISAT U BOSES is listening at http://localhost:${port}`);
  });
}

module.exports = app;

if (require.main === module) {
  start().catch(async (error) => {
    if (error.code === 'SELF_SIGNED_CERT_IN_CHAIN') {
      console.error(
        'Could not start ISAT U BOSES: set SUPABASE_DB_CA_CERT_CONTENT to the Supabase database CA PEM or SUPABASE_DB_CA_CERT to its local path.',
      );
    } else {
      console.error('Could not start ISAT U BOSES:', error.message);
    }
    await pool.end();
    process.exitCode = 1;
  });
}
