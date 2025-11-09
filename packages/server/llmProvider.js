const { callChatCompletion, hasLLMProvider } = require('./llmClient');
const { logSlice, logRequest } = require('./runtimeLogger');
const { checkScript } = require('./scriptCheck');

const SLICE_MIN_LINES = Number(process.env.WEBGAL_RUNTIME_SLICE_MIN ?? 4);
const SLICE_MAX_LINES = Number(process.env.WEBGAL_RUNTIME_SLICE_MAX ?? 9);

const WRITE_MODEL = process.env.LLM_WRITE_MODEL || 'google/gemini-2.5-flash';
const WRITE_TEMPERATURE = Number(process.env.LLM_WRITE_TEMPERATURE ?? 0.75);

const DEFAULT_PLAN = {
  premise: 'An anonymous contract asks the lead to infiltrate the old city and find a missing engineer.',
  theme: 'Trust and sacrifice',
  tone: 'Suspense',
  endings: [],
  cast: [],
  signals: {},
  golden_rules: [],
};

const RUNTIME_SLICE_SCHEMA = {
  name: 'webgal_runtime_slice',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      lines: {
        type: 'array',
        minItems: SLICE_MIN_LINES,
        maxItems: SLICE_MAX_LINES,
        items: {
          oneOf: [
            {
              type: 'object',
              properties: {
                type: { const: 'intro' },
                text: { type: 'string' },
              },
              required: ['type', 'text'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { const: 'narration' },
                text: { type: 'string' },
              },
              required: ['type', 'text'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { const: 'dialog' },
                speaker: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['type', 'speaker', 'text'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { const: 'setVar' },
                key: { type: 'string' },
                expression: { type: 'string' },
              },
              required: ['type', 'key', 'expression'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { const: 'choice' },
                options: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 2,
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      target: { type: 'string' },
                    },
                    required: ['label', 'target'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['type', 'options'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { const: 'end' },
              },
              required: ['type'],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ['lines'],
    additionalProperties: false,
  },
};

const WEBGAL_EXAMPLE = `<example>
intro:Sensor sweep paints the atrium in cold violet light;
:MC:I tag the suspect avatar and mirror their biometrics;
:setVar:System_Integrity=System_Integrity-5;
choose:Trace the signal:runtime/act-1/trace.txt|Flag the judge:runtime/act-1/report.txt;
</example>`;

const WS_OUTPUT_POLICY = `Output requirements:
- Only emit WebGAL script lines; every line must end with ';'. Do not include explanations, Markdown, JSON, code blocks, or blank lines.
- Each slice must contain exactly ${SLICE_MIN_LINES}~${SLICE_MAX_LINES} lines. The last line must be choose:…; (two runtime targets) or end; (only when a finale is unlocked). All other lines must advance action/dialog/narration/setVar.
- Do not end early; every non-final line must show concrete actions, sensations, or emotions, never recap previous slices.
- choose lines must contain two distinct options pointing to runtime/<arc>/<node>.txt targets.
- choose lines must follow \`choose:LabelA:runtime/arc/node.txt|LabelB:runtime/arc/node.txt;\` exactly - no quotes, extra semicolons, or line breaks.
- Use ASCII punctuation only.
${WEBGAL_EXAMPLE}`;

function unwrapJsonPayload(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  if (!str) return '';
  const fenceMatch = str.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return str;
}

function formatList(arr, formatter) {
  if (!Array.isArray(arr) || arr.length === 0) return '- (not defined)';
  return arr.map(formatter).join('\n');
}

function formatCast(cast) {
  return formatList(cast, (item) => {
    const goals = Array.isArray(item.goals) ? item.goals.join('/') : 'unknown goals';
    const flaws = Array.isArray(item.flaws) ? item.flaws.join('/') : 'unknown flaws';
    const tags = Array.isArray(item.tags) ? item.tags.join('/') : 'unknown traits';
    return `- ${item.name || item.id || 'Character'} (tags: ${tags}) goals[${goals}] flaws[${flaws}]`;
  });
}

function formatSignalsDefinition(signals) {
  const entries = signals && typeof signals === 'object' ? Object.entries(signals) : [];
  if (entries.length === 0) return '- (not set)';
  return entries
    .map(([key, cfg]) => {
      const desc = cfg?.desc || 'no description';
      const min = cfg?.min ?? 'NA';
      const max = cfg?.max ?? 'NA';
      return `- ${key}: ${desc} (range ${min}~${max})`;
    })
    .join('\n');
}

function formatSignalsState(signals) {
  const entries = signals && typeof signals === 'object' ? Object.entries(signals) : [];
  if (entries.length === 0) return 'no signals';
  return entries.map(([key, value]) => `${key}:${value}`).join(', ');
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function cleanSpeaker(text) {
  return cleanText(text).replace(/:/g, '');
}

function cleanLabel(text) {
  return cleanText(text).replace(/:/g, '-').replace(/\|/g, '/');
}

const RUNTIME_TARGET_REGEX = /^runtime\/[A-Za-z0-9_\-/]+\.txt$/;

function buildScriptFromJson(lines) {
  const errors = [];
  if (!Array.isArray(lines)) {
    errors.push('lines must be an array');
    return { errors };
  }
  if (lines.length < SLICE_MIN_LINES || lines.length > SLICE_MAX_LINES) {
    errors.push(`lines must contain ${SLICE_MIN_LINES}-${SLICE_MAX_LINES} entries`);
  }
  const scriptLines = [];
  let lastType = null;
  lines.forEach((line, index) => {
    if (!line || typeof line !== 'object') {
      errors.push(`Line ${index + 1} is not an object`);
      return;
    }
    const rawType = line.type;
    const type = rawType === 'choose' ? 'choice' : rawType;
    lastType = type;
    switch (type) {
      case 'intro': {
        const text = cleanText(line.text);
        if (!text) {
          errors.push(`Line ${index + 1} intro text is empty`);
          break;
        }
        scriptLines.push(`intro:${text};`);
        break;
      }
      case 'narration': {
        const text = cleanText(line.text);
        if (!text) {
          errors.push(`Line ${index + 1} narration text is empty`);
          break;
        }
        scriptLines.push(`:${text};`);
        break;
      }
      case 'dialog': {
        const speaker = cleanSpeaker(line.speaker);
        const text = cleanText(line.text);
        if (!speaker) {
          errors.push(`Line ${index + 1} dialog speaker is empty`);
          break;
        }
        if (!text) {
          errors.push(`Line ${index + 1} dialog text is empty`);
          break;
        }
        scriptLines.push(`${speaker}:${text};`);
        break;
      }
      case 'setVar': {
        const key = cleanText(line.key).replace(/[^A-Za-z0-9_]/g, '');
        const expression = String(line.expression || '').replace(/;/g, '');
        if (!key) {
          errors.push(`Line ${index + 1} setVar key is empty`);
          break;
        }
        if (!expression.trim()) {
          errors.push(`Line ${index + 1} setVar expression is empty`);
          break;
        }
        scriptLines.push(`setVar:${key}=${expression.trim()};`);
        break;
      }
      case 'choice': {
        if (index !== lines.length - 1) {
          errors.push('choice line must be last');
        }
        const options = Array.isArray(line.options) ? line.options : [];
        if (options.length !== 2) {
          errors.push('choice line must contain exactly 2 options');
          break;
        }
        const formatted = options
          .map((opt, optIdx) => {
            const label = cleanLabel(opt?.label);
            const target = cleanText(opt?.target);
            if (!label) {
              errors.push(`choice option ${optIdx + 1} label is empty`);
            }
            if (!RUNTIME_TARGET_REGEX.test(target)) {
              errors.push(`choice option ${optIdx + 1} target invalid: ${target}`);
            }
            return `${label}:${target}`;
          })
          .join('|');
        scriptLines.push(`choose:${formatted};`);
        break;
      }
      case 'end': {
        if (index !== lines.length - 1) {
          errors.push('end line must be last');
        }
        scriptLines.push('end;');
        break;
      }
      default:
        errors.push(`Line ${index + 1} has unknown type ${type}`);
    }
  });
  if (lastType !== 'choice' && lastType !== 'end') {
    errors.push('Last line must be of type choice or end');
  }
  return { script: scriptLines.join('\n'), errors };
}

function buildSystemPrompt(planInput = {}) {
  const plan = { ...DEFAULT_PLAN, ...planInput };
  const endingsStr = formatEndings(plan.endings);
  const outline = formatList(plan.outline, (line, idx) => `  ${idx + 1}. ${line}`);
  const cast = formatCast(plan.cast);
  const signalsDef = formatSignalsDefinition(plan.signals);
  const rules = formatList(plan.golden_rules, (rule, idx) => `${idx + 1}. ${rule}`);

  return `You are a WebGAL runtime slice author. The script is executed directly by the engine, so you must obey every rule and only output WebGAL lines.

[Setting]
- Premise: ${plan.premise || 'not provided'}
- Theme: ${plan.theme || 'unknown'}
- Tone: ${plan.tone || 'unknown'}
- Possible endings: ${endingsStr}

[Cast]
${cast}

[Signal definitions]
${signalsDef}

[Outline]
${outline}

[Golden rules]
${rules}

${WS_OUTPUT_POLICY}
- At least one signal change must eventually be applied via setVar in subsequent slices (you can foreshadow it here).`;
}

function formatEndings(endings) {
  if (!Array.isArray(endings) || endings.length === 0) {
    return 'not defined';
  }
  return endings
    .map((ending) => {
      if (!ending) return '';
      if (typeof ending === 'string') return ending;
      if (typeof ending === 'object') {
        return ending.name || ending.label || ending.condition || JSON.stringify(ending);
      }
      return String(ending);
    })
    .filter((entry) => entry && entry.length > 0)
    .join(' / ');
}

function formatActiveCast(cast = [], recapText = '') {
  if (!Array.isArray(cast) || cast.length === 0) return '  · (none)';
  const entries = cast
    .map((c) => {
      const name = (c.name || c.id || '').trim();
      if (!name) return null;
      const goals = Array.isArray(c.goals) ? c.goals.join('/') : c.goals || '';
      const flaws = Array.isArray(c.flaws) ? c.flaws.join('/') : c.flaws || '';
      const hit = recapText.includes(name) ? 1 : 0;
      return { line: `  · ${name} | goals: ${goals || '-'} | flaws: ${flaws || '-'}`, score: hit };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => entry.line);
  return entries.length ? entries.join('\n') : '  · (none)';
}

function buildUserPrompt(gameSlug, sliceId, recap, signals, session, plan) {
  const signalStr = formatSignalsState(signals);
  const recapText = recap && recap.trim().length > 0 ? recap.trim() : 'No recap yet.';
  const castBrief = formatActiveCast(plan?.cast, recapText);
  return `[Current slice]
- Game: ${gameSlug}
- Session: ${session || 'default'}
- Slice: ${sliceId}
- Recap: ${recapText}
- Signals: ${signalStr}
- Key cast:
${castBrief}

Follow every rule (WebGAL lines only):
${WS_OUTPUT_POLICY}

Return JSON that matches the schema webgal_runtime_slice (lines[] containing intro/narration/dialog/setVar/choice/end objects). Output JSON only.`;
}

/**
 * Example runtime scene generator built on OpenRouter Chat Completions.
 * The return value must be plain WebGAL text with semicolons at the end of each line.
 */
async function callModel(model, gameSlug, sliceId, systemPrompt, userPrompt, label, responseFormat) {
  logRequest(gameSlug, `${sliceId} (${label})`, { model, systemPrompt, userPrompt });
  const { content } = await callChatCompletion({
    model,
    temperature: WRITE_TEMPERATURE,
    response_format: responseFormat,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return content || '';
}

function formatErrors(errors) {
  return errors.map((err, idx) => `${idx + 1}. ${err}`).join('\n');
}

function buildRepairPrompt(errors, previousPayload) {
  const payloadString =
    typeof previousPayload === 'string'
      ? previousPayload
      : JSON.stringify(previousPayload || {}, null, 2);
  return `[Repair instructions]
The previous JSON slice had the following issues:
${formatErrors(errors)}
Return a BRAND NEW JSON object that obeys the webgal_runtime_slice schema (lines[] with intro/narration/dialog/setVar/choice/end). Produce ${SLICE_MIN_LINES}~${SLICE_MAX_LINES} entries, end with a choice or end block, and avoid unsupported commands entirely.
Previous invalid JSON:
${payloadString}`;
}

function evaluateStructuredResponse(raw) {
  const errors = [];
  const normalized = unwrapJsonPayload(raw);
  if (!normalized) {
    errors.push('Model returned empty response');
    return { errors };
  }
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (err) {
    errors.push(`Invalid JSON response: ${err.message}`);
    return { errors, raw: normalized };
  }
  const { script, errors: buildErrors } = buildScriptFromJson(parsed.lines);
  if (buildErrors.length) {
    errors.push(...buildErrors);
    return { errors, parsed };
  }
  const check = checkScript(script);
  if (!check.ok) {
    errors.push(...check.errors);
    return { errors, parsed };
  }
  return { script, parsed };
}

async function getRuntimeSlice(gameSlug, sliceId, context = {}) {
  if (!hasLLMProvider) {
    return `intro:(No LLM provider configured; cannot generate ${gameSlug}/${sliceId});\nend;`;
  }
  const systemPrompt = buildSystemPrompt(context.plan);
  const userPrompt = buildUserPrompt(
    gameSlug,
    sliceId,
    context.recap,
    context.signals,
    context.session,
    context.plan,
  );

  const model = WRITE_MODEL;

  const loggingId = context.session ? `${sliceId}[sid=${context.session}]` : sliceId;
  const responseFormat = { type: 'json_schema', json_schema: RUNTIME_SLICE_SCHEMA };

  const firstRaw = await callModel(model, gameSlug, loggingId, systemPrompt, userPrompt, 'initial', responseFormat);
  const firstEval = evaluateStructuredResponse(firstRaw);
  if (firstEval.script && (!firstEval.errors || firstEval.errors.length === 0)) {
    logSlice(gameSlug, loggingId, firstEval.script);
    return firstEval.script;
  }

  const fixPrompt = `${userPrompt}\n\n${buildRepairPrompt(firstEval.errors || ['Unknown error'], firstEval.parsed || firstRaw)}`;

  const secondRaw = await callModel(model, gameSlug, loggingId, systemPrompt, fixPrompt, 'retry', responseFormat);
  const secondEval = evaluateStructuredResponse(secondRaw);
  if (secondEval.script && (!secondEval.errors || secondEval.errors.length === 0)) {
    logSlice(gameSlug, loggingId, secondEval.script);
    return secondEval.script;
  }

  // Plain-text fallback: ask model to emit WebGAL directly without JSON schema.
  const plainSystemPrompt = `${systemPrompt}\n\nReturn raw WebGAL script lines only (no JSON, no explanations).`;
  const plainUserPrompt = `${userPrompt}\n\nOutput raw WebGAL script lines only (no JSON, no explanations).`;
  try {
    const plainRaw = await callModel(model, gameSlug, loggingId, plainSystemPrompt, plainUserPrompt, 'plain-fallback', undefined);
    const candidate = (plainRaw || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');
    const check = checkScript(candidate);
    if (check.ok) {
      logSlice(gameSlug, loggingId, candidate);
      return candidate;
    }
    console.warn(`[runtime] plain fallback failed script check for ${gameSlug}/${sliceId}: ${check.errors.join('; ')}`);
  } catch (err) {
    console.warn(`[runtime] plain fallback failed for ${gameSlug}/${sliceId}: ${err.message}`);
  }

  return `intro:(Generation failed; check the prompt settings for ${gameSlug}/${sliceId});\nend;`;
}

module.exports = { getRuntimeSlice };
