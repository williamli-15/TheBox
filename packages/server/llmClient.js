const OpenAI = require('openai');

const OPENROUTER_BASE_URL = process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 2048);
const hasLLMProvider = Boolean(OPENROUTER_API_KEY);

let openRouterClient = null;

function buildDefaultHeaders() {
  const headers = {};
  if (process.env.OPENROUTER_HTTP_REFERRER) {
    headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERRER;
  }
  if (process.env.OPENROUTER_SITE_TITLE) {
    headers['X-Title'] = process.env.OPENROUTER_SITE_TITLE;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function getOpenRouterClient() {
  if (!hasLLMProvider) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }
  if (!openRouterClient) {
    openRouterClient = new OpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: buildDefaultHeaders(),
    });
  }
  return openRouterClient;
}

function normalizeOpenAIContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (part.type === 'reasoning' && part.reasoning) {
          return part.reasoning;
        }
        if (part.text) return part.text;
        return JSON.stringify(part);
      })
      .join('\n');
  }
  if (typeof content === 'object' && content.text) {
    return content.text;
  }
  return String(content);
}

async function callChatCompletion({
  model,
  messages,
  temperature,
  top_p,
  response_format,
  max_tokens,
}) {
  if (!hasLLMProvider) {
    throw new Error('No LLM provider configured');
  }
  const clampTemp = (val) => {
    if (typeof val !== 'number' || Number.isNaN(val)) return undefined;
    return Math.max(0, Math.min(val, 1));
  };
  const normalizedTemp = clampTemp(temperature);
  const normalizedTopP =
    typeof top_p === 'number' && !Number.isNaN(top_p) ? Math.max(0, Math.min(top_p, 1)) : undefined;
  const client = getOpenRouterClient();
  const payload = {
    model,
    messages,
    temperature: normalizedTemp,
  };
  if (typeof top_p === 'number') {
    payload.top_p = normalizedTopP;
  }
  if (response_format) {
    payload.response_format = response_format;
  }
  if (typeof max_tokens === 'number') {
    payload.max_output_tokens = max_tokens;
  }
  const response = await client.chat.completions.create(payload);
  const message = response.choices?.[0]?.message || {};
  const reasoningText = message.reasoning_content || '';
  const content = normalizeOpenAIContent(message.content).trim();
  return { content, reasoning: reasoningText, raw: response };
}

module.exports = {
  callChatCompletion,
  hasLLMProvider,
};
