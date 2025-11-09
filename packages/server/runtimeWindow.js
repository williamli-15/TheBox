const runtimeSceneProvider = require('./runtimeSceneProvider');

const CACHE_TTL = Number(process.env.WEBGAL_RUNTIME_CACHE_TTL ?? 10 * 60 * 1000); // 10 minutes
const PREFETCH_DEPTH = Number(process.env.WEBGAL_RUNTIME_PREFETCH_DEPTH ?? 2);
const MAX_CONCURRENCY = Number(process.env.WEBGAL_RUNTIME_PREFETCH_CONCURRENCY ?? 4);
const DEFAULT_SESSION = 'default';

const cache = new Map(); // key -> { text, ts }
const pending = new Map(); // key -> Promise
let inflight = 0;

function normalizeSession(value) {
  if (!value || typeof value !== 'string') return DEFAULT_SESSION;
  return value.trim().slice(0, 64) || DEFAULT_SESSION;
}

function makeKey(slug, sliceId, session) {
  return `${slug}::${session}::${sliceId}`;
}

function isExpired(entry) {
  if (!entry) return true;
  return Date.now() - entry.ts > CACHE_TTL;
}

function getCached(slug, sliceId, session) {
  const key = makeKey(slug, sliceId, session);
  const entry = cache.get(key);
  if (!entry || isExpired(entry)) {
    cache.delete(key);
    return null;
  }
  return entry.text;
}

function storeCache(slug, sliceId, session, text) {
  cache.set(makeKey(slug, sliceId, session), { text, ts: Date.now() });
}

function extractTargets(text) {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const last = lines[lines.length - 1];
  if (!last.startsWith('choose:')) return [];
  const body = last.slice(7, -1).trim();
  if (!body) return [];
  return body.split('|').map((item) => {
    const segments = item.split(':');
    const target = segments.slice(-1)[0];
    return target.replace(/\.txt$/, '');
  });
}

async function limitConcurrency(fn) {
  while (inflight >= MAX_CONCURRENCY) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
  }
}

async function runFetch(slug, sliceId, options, depth, session) {
  const text = await limitConcurrency(() =>
    runtimeSceneProvider.getRuntimeSlice(slug, sliceId, options),
  );
  if (text) {
    storeCache(slug, sliceId, session, text);
    if (depth > 0) {
      schedulePrefetch(slug, text, options, depth - 1);
    }
  }
  return text;
}

function schedulePrefetch(slug, text, options, depth) {
  if (depth <= 0) return;
  const targets = extractTargets(text);
  for (const target of targets) {
    void ensureInternal(slug, target, { ...options, prefetch: true }, depth);
  }
}

async function ensureInternal(slug, sliceId, options, depth) {
  const session = normalizeSession(options.sid);
  const cached = getCached(slug, sliceId, session);
  if (cached) {
    if (depth > 0) {
      schedulePrefetch(slug, cached, options, depth - 1);
    }
    return cached;
  }
  const key = makeKey(slug, sliceId, session);
  if (!pending.has(key)) {
    pending.set(
      key,
      runFetch(slug, sliceId, { ...options, sid: session }, depth, session)
        .catch((err) => {
          console.error(`[runtime-window] slice ${slug}/${sliceId} failed:`, err);
          return null;
        })
        .finally(() => pending.delete(key)),
    );
  }
  return pending.get(key);
}

async function ensureSlice(slug, sliceId, options = {}) {
  const depthFromOptions =
    typeof options.depth === 'number' && Number.isFinite(options.depth) ? options.depth : null;
  const depth = Math.max(depthFromOptions ?? PREFETCH_DEPTH, 1);
  return ensureInternal(
    slug,
    sliceId,
    { ...options, prefetch: options.prefetch === true, sid: normalizeSession(options.sid) },
    depth,
  );
}

module.exports = {
  ensureSlice,
};
