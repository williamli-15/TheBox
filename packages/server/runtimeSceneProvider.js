const fs = require('fs');
const path = require('path');
const llmProvider = require('./llmProvider');

// 允许通过环境变量覆盖默认的运行时剧情生成器
let customProvider = null;
const providerPath = process.env.WEBGAL_RUNTIME_PROVIDER
  ? path.resolve(process.cwd(), process.env.WEBGAL_RUNTIME_PROVIDER)
  : null;

if (providerPath && fs.existsSync(providerPath)) {
  customProvider = require(providerPath);
}

const normalizeSliceId = (sliceId) => sliceId.replace(/\\/g, '/').replace(/\.txt$/, '');

const fallbackSlice = (gameSlug, sliceId) => `intro:${gameSlug}/${sliceId} 未能生成剧情，请检查 LLM 配置;`;

async function tryProvider(provider, label, slug, sliceId) {
  if (!provider || typeof provider.getRuntimeSlice !== 'function') {
    return null;
  }
  console.info(`[runtime] -> ${label} request ${slug}/${sliceId}`);
  try {
    const result = await provider.getRuntimeSlice(slug, sliceId);
    if (result && result.trim().length > 0) {
      console.info(`[runtime] <- ${label} produced ${result.length} chars for ${slug}/${sliceId}`);
      return result;
    }
    console.warn(`[runtime] ${label} returned empty result for ${slug}/${sliceId}`);
  } catch (err) {
    console.error(`[runtime] ${label} failed for ${slug}/${sliceId}:`, err);
  }
  return null;
}

async function getRuntimeSlice(gameSlug, rawSliceId) {
  const normalizedSlug = (gameSlug || 'default').toLowerCase();
  const sliceId = normalizeSliceId(rawSliceId);

  const providers = [];
  if (customProvider) {
    providers.push({ provider: customProvider, label: 'custom-provider' });
  }
  if (process.env.OPENAI_API_KEY) {
    providers.push({ provider: llmProvider, label: 'llm-provider' });
  }

  for (const { provider, label } of providers) {
    const res = await tryProvider(provider, label, normalizedSlug, sliceId);
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
