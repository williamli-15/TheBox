import fs from 'fs/promises';
import path from 'path';
import llmClientModule from '../packages/server/llmClient.js';

const GAME_SLUG = process.env.GAME_SLUG ?? 'story-lab';
const GAME_DIR = path.resolve('packages/webgal/public/games', GAME_SLUG);
const PLAN_PATH = path.join(GAME_DIR, 'story', 'plan.json');
const OUT_PATH = path.join(GAME_DIR, 'story', 'plan_eval.json');

const { callChatCompletion, hasLLMProvider } = llmClientModule;
const THINK_MODEL = process.env.LLM_THINK_MODEL || 'google/gemini-2.5-flash';
const THINK_TEMPERATURE = Number(process.env.LLM_THINK_TEMPERATURE ?? 1.2);
const THINK_REASONING_TOKENS = Number(process.env.LLM_THINK_REASON_TOKENS ?? 2048);
const CRITIQUE_SCHEMA = {
  name: 'plan_eval',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      score: { type: 'number', description: 'Appeal score 0-100' },
      pros: { type: 'array', items: { type: 'string' } },
      cons: { type: 'array', items: { type: 'string' } },
      fixes: { type: 'array', items: { type: 'string' } },
      remarks: { type: 'string' },
    },
    required: ['score', 'pros', 'cons', 'fixes', 'remarks'],
    additionalProperties: false,
  },
};

function structuralCheck(plan) {
  const errors = [];
  if (!plan?.premise) errors.push('Missing premise');
  if (!plan?.theme) errors.push('Missing theme');
  if (!Array.isArray(plan?.cast) || plan.cast.length < 2) errors.push('Cast must contain at least 2 members');
  if (!plan?.signals || Object.keys(plan.signals).length < 2) errors.push('Signals definition is insufficient');
  if (!Array.isArray(plan?.outline) || plan.outline.length < 5) errors.push('Outline must include at least 5 beats');
  if (!Array.isArray(plan?.endings) || plan.endings.length < 3) errors.push('Need at least 3 endings');
  return errors;
}

async function critiquePlan(plan) {
  if (!hasLLMProvider) {
    throw new Error('LLM provider is not configured');
  }
  const prompt = `
You are a veteran interactive-fiction editor. Critique the following outline with highlights, risks, pacing breaks, character consistency, and payoff hooks. Provide 5 actionable improvement tips, then assign an appeal score from 0-100.
Output JSON only: {"score":88,"pros":[],"cons":[],"fixes":[],"remarks":""}
Plan:
${JSON.stringify(plan, null, 2)}
`;
  const { content } = await callChatCompletion({
    model: THINK_MODEL,
    temperature: THINK_TEMPERATURE,
    top_p: 0.9,
    response_format: {
      type: 'json_schema',
      json_schema: CRITIQUE_SCHEMA,
    },
    reasoning:
      THINK_REASONING_TOKENS > 0
        ? {
            max_tokens: THINK_REASONING_TOKENS,
            exclude: true,
          }
        : undefined,
    messages: [
      { role: 'system', content: 'Output JSON only with no extra text.' },
      { role: 'user', content: prompt },
    ],
  });
  const txt = content?.trim() || '{}';
  return JSON.parse(txt);
}

async function main() {
  try {
    const raw = await fs.readFile(PLAN_PATH, 'utf-8');
    const plan = JSON.parse(raw);
    const structErrors = structuralCheck(plan);
    let critique = null;
    try {
      critique = await critiquePlan(plan);
    } catch (err) {
      critique = { error: err.message };
    }
    await fs.writeFile(OUT_PATH, JSON.stringify({ structErrors, critique }, null, 2), 'utf-8');
    console.log(`✅ Plan evaluation written to ${OUT_PATH}`);
  } catch (err) {
    console.error(`❌ plan-eval failed: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
