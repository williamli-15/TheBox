const fs = require('fs');
const path = require('path');
const llmProvider = require('./llmProvider');
const { getPlan } = require('./storyPlan');
const { getRecap, getSignals, recordSlice, updateSignalsFromSlice } = require('./storyState');

// 允许通过环境变量覆盖默认的运行时剧情生成器
let customProvider = null;
const providerPath = process.env.WEBGAL_RUNTIME_PROVIDER
  ? path.resolve(process.cwd(), process.env.WEBGAL_RUNTIME_PROVIDER)
  : null;

if (providerPath && fs.existsSync(providerPath)) {
  customProvider = require(providerPath);
}

const { hasLLMProvider } = require('./llmClient');
const hasLLM = hasLLMProvider;

const normalizeSliceId = (sliceId) => sliceId.replace(/\\/g, '/').replace(/\.txt$/, '');

const fallbackSlice = (gameSlug, sliceId) => `intro:${gameSlug}/${sliceId} 未能生成剧情，请检查 LLM 配置;`;

async function tryProvider(provider, label, slug, sliceId, context) {
  if (!provider || typeof provider.getRuntimeSlice !== 'function') {
    return null;
  }
  const sessionLabel = context?.session ? ` sid=${context.session}` : '';
  console.info(`[runtime] -> ${label} request ${slug}/${sliceId}${sessionLabel}`);
  try {
    const result = await provider.getRuntimeSlice(slug, sliceId, context);
    if (result && result.trim().length > 0) {
      console.info(
        `[runtime] <- ${label} produced ${result.length} chars for ${slug}/${sliceId}${sessionLabel}`,
      );
      if (!context?.prefetch && context?.plan) {
        recordSlice(slug, context.session, context.plan, result);
        updateSignalsFromSlice(slug, context.session, context.plan, result);
      }
      return result;
    }
    console.warn(`[runtime] ${label} returned empty result for ${slug}/${sliceId}`);
  } catch (err) {
    console.error(`[runtime] ${label} failed for ${slug}/${sliceId}:`, err);
  }
  return null;
}

async function getRuntimeSlice(gameSlug, rawSliceId, options = {}) {
  const normalizedSlug = (gameSlug || 'default').toLowerCase();
  const sliceId = normalizeSliceId(rawSliceId);
  const gameDir = options.gameDir;
  const session = options.sid || 'default';

  let plan = null;
  let context = null;
  if (gameDir) {
    try {
      plan = getPlan(gameDir);
      context = {
        plan,
        recap: getRecap(normalizedSlug, plan, session),
        signals: getSignals(normalizedSlug, plan, session),
        prefetch: options.prefetch === true,
        session,
      };
    } catch (err) {
      console.error(`[runtime] failed to load plan for ${normalizedSlug}:`, err.message);
    }
  }

  const baseContext =
    context || {
      plan: null,
      recap: '',
      signals: {},
      session,
      prefetch: options.prefetch === true,
    };

  const providers = [];
  if (customProvider) {
    providers.push({ provider: customProvider, label: 'custom-provider' });
  }
  if (hasLLM) {
    providers.push({ provider: llmProvider, label: 'llm-provider' });
  }

  for (const { provider, label } of providers) {
    const res = await tryProvider(provider, label, normalizedSlug, sliceId, baseContext);
    if (res) {
      return res;
    }
  }

  console.error(`[runtime] fallback reached for ${normalizedSlug}/${sliceId}`);
  return fallbackSlice(normalizedSlug, sliceId);
}

module.exports = {
  getRuntimeSlice,
};
