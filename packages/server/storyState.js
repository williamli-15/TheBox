const DEFAULT_RECAP = '剧情刚刚开始。';
const DEFAULT_SESSION = 'default';

const stateStore = new Map();

function makeKey(slug, session) {
  const normalizedSlug = (slug || 'default').toLowerCase();
  const normalizedSession =
    session && typeof session === 'string' && session.trim().length > 0
      ? session.trim().slice(0, 64)
      : DEFAULT_SESSION;
  return `${normalizedSlug}::${normalizedSession}`;
}

function initState(slug, session, plan) {
  const key = makeKey(slug, session);
  if (!stateStore.has(key)) {
    stateStore.set(key, {
      recaps: [],
      recap: DEFAULT_RECAP,
      signals: buildInitialSignals(plan),
    });
  }
  return stateStore.get(key);
}

function buildInitialSignals(plan) {
  const result = {};
  if (plan && plan.signals) {
    for (const [key, cfg] of Object.entries(plan.signals)) {
      if (cfg && typeof cfg === 'object') {
        if (typeof cfg.default === 'number') {
          result[key] = cfg.default;
        } else if (typeof cfg.min === 'number' && typeof cfg.max === 'number') {
          result[key] = Math.round((cfg.min + cfg.max) / 2);
        } else {
          result[key] = 0;
        }
      } else {
        result[key] = 0;
      }
    }
  }
  return result;
}

function getRecap(slug, plan, session) {
  const state = initState(slug, session, plan);
  return state.recap || DEFAULT_RECAP;
}

function getSignals(slug, plan, session) {
  const state = initState(slug, session, plan);
  return state.signals;
}

function summarizeSlice(text) {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('choose:'));
  const joined = lines.join(' ');
  if (joined.length <= 400) {
    return joined;
  }
  return joined.slice(joined.length - 400);
}

function recordSlice(slug, session, plan, text) {
  const state = initState(slug, session, plan);
  const summary = summarizeSlice(text);
  if (!summary) {
    return;
  }
  state.recaps.push(summary);
  if (state.recaps.length > 2) {
    state.recaps.shift();
  }
  state.recap = state.recaps.join(' ');
}

function parseSetVar(line) {
  const match = line.match(/^setVar:([a-zA-Z0-9_]+)=(.+);$/);
  if (!match) return null;
  const key = match[1];
  const expression = match[2].trim();
  return { key, expression };
}

function clampValue(plan, key, value) {
  if (!plan || !plan.signals || !plan.signals[key]) return value;
  const cfg = plan.signals[key];
  let result = value;
  if (typeof cfg.min === 'number') {
    result = Math.max(cfg.min, result);
  }
  if (typeof cfg.max === 'number') {
    result = Math.min(cfg.max, result);
  }
  return result;
}

function evaluateExpression(expression, state, key) {
  const trimmed = expression.replace(/;$/, '').trim();
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  const opMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*([+-])\s*(\d+(?:\.\d+)?)$/);
  if (opMatch) {
    const baseKey = opMatch[1];
    const operator = opMatch[2];
    const delta = Number(opMatch[3]);
    const base = typeof state.signals[baseKey] === 'number' ? state.signals[baseKey] : 0;
    return operator === '+' ? base + delta : base - delta;
  }
  if (/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    const refKey = trimmed;
    if (typeof state.signals[refKey] === 'number') {
      return state.signals[refKey];
    }
    if (refKey === key) {
      return state.signals[key] || 0;
    }
  }
  return null;
}

function updateSignalsFromSlice(slug, session, plan, text) {
  const state = initState(slug, session, plan);
  if (!text) return;
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    if (!line.startsWith('setVar:')) continue;
    const parsed = parseSetVar(line);
    if (!parsed) continue;
    const { key, expression } = parsed;
    if (!(key in state.signals)) continue;
    const evaluated = evaluateExpression(expression, state, key);
    if (typeof evaluated !== 'number' || Number.isNaN(evaluated)) continue;
    state.signals[key] = clampValue(plan, key, evaluated);
  }
}

module.exports = {
  getRecap,
  getSignals,
  recordSlice,
  updateSignalsFromSlice,
};
