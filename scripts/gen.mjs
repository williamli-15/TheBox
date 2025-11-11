// File: scripts/gen.mjs (placed in the repository root)
// Run with Node 18+: node scripts/gen.mjs
import fs from 'fs/promises';
import path from 'path';
import llmClientModule from '../packages/server/llmClient.js';

const GAME_SLUG = process.env.GAME_SLUG ?? 'story-lab';
const GAME_ROOT = path.resolve('packages/webgal/public/games', GAME_SLUG);
const STORY_DIR = path.join(GAME_ROOT, 'story');
const PLAN_PATH = path.join(STORY_DIR, 'plan.json');
const USER_TITLE = process.env.GEN_USER_TITLE?.trim();
const USER_BRIEF = process.env.GEN_USER_BRIEF?.trim();
const SLICE_MIN_LINES = Number(process.env.WEBGAL_RUNTIME_SLICE_MIN ?? 4);
const SLICE_MAX_LINES = Number(process.env.WEBGAL_RUNTIME_SLICE_MAX ?? 9);
const SEED_BANK = [
  {
    tag: 'Campus Courtroom Thriller',
    line: 'A disgraced law prodigy must defend a rival on trial for a campus dean’s murder.',
  },
  {
    tag: 'Boarding School Mystery',
    line: 'A student council hearing unravels when a missing classmate’s diary implicates everyone.',
  },
  {
    tag: 'Celebrity Trial Drama',
    line: 'A rookie defense team faces viral outrage while proving a pop idol’s innocence.',
  },
  {
    tag: 'Small-Town Cold Case',
    line: 'A podcasting duo reopens a decade-old disappearance and exposes the local court.',
  },
  {
    tag: 'Esports Contract Scandal',
    line: 'A college team’s MVP sues their former coach for sabotaging their pro debut.',
  },
  {
    tag: 'Reality Show Jury',
    line: 'Contestants trapped in a mansion must vote who tampered with the live feed before finale night.',
  },
  {
    tag: 'Family Estate Dispute',
    line: 'Siblings battle in probate court while a hidden will surfaces during cross-exam.',
  },
  {
    tag: 'Gothic Theater Troupe',
    line: 'A director collapses on stage, forcing understudies to prove whether it was sabotage.',
  },
  {
    tag: 'True-Crime Club',
    line: 'Students recreating infamous trials realize their advisor is hiding real evidence.',
  },
  {
    tag: 'City Hall Whistleblower',
    line: 'An aide leaks budget fraud files and must outmaneuver the mayor’s legal machine.',
  },
];

const { callChatCompletion, hasLLMProvider } = llmClientModule;
const HAS_LLM = hasLLMProvider;
const THINK_MODEL = process.env.LLM_THINK_MODEL || 'google/gemini-2.5-flash';
const WRITE_MODEL = process.env.LLM_WRITE_MODEL || 'google/gemini-2.5-flash';
const THINK_TEMPERATURE = Number(process.env.LLM_THINK_TEMPERATURE ?? 1.2);
const WRITE_TEMPERATURE = Number(process.env.LLM_WRITE_TEMPERATURE ?? 0.95);
const STRUCT_TEMPERATURE = Number(process.env.LLM_PLAN_TEMPERATURE ?? 0.55);
const GEN_LOG_DISABLED = process.env.GEN_LOG_DISABLE === '1';
const GEN_LOG_ROOT = path.resolve(process.env.GEN_LOG_ROOT || 'logs');
const GEN_LOG_DIR = path.join(GEN_LOG_ROOT, 'gen', GAME_SLUG);
const GEN_RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const GEN_LOG_PATH = path.join(GEN_LOG_DIR, `${GEN_RUN_ID}.log`);
const PLAN_JSON_SCHEMA = {
  name: 'webgal_plan',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional title' },
      premise: { type: 'string', description: 'Premise' },
      theme: { type: 'string', description: 'Theme' },
      tone: { type: 'string', description: 'Tone' },
      endings: {
        type: 'array',
        minItems: 3,
        description: 'List of potential endings',
        items: {
          anyOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                desc: { type: 'string' },
                condition: { type: 'string' },
                cost: { type: 'string' },
              },
              additionalProperties: true,
            },
          ],
        },
      },
      cast: {
        type: 'array',
        minItems: 2,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            goals: { type: 'array', items: { type: 'string' } },
            flaws: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['id'],
          additionalProperties: true,
        },
      },
      signals: {
        type: 'object',
        description: 'Signal configuration',
        additionalProperties: {
          type: 'object',
          properties: {
            min: { type: 'number' },
            max: { type: 'number' },
            default: { type: 'number' },
            desc: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
      outline: {
        type: 'array',
        minItems: 5,
        items: { type: 'string' },
      },
      golden_rules: {
        type: 'array',
        items: { type: 'string' },
      },
      warmup: {
        type: 'object',
        properties: {
          entry: { type: 'string' },
          depth: { type: 'number' },
        },
        required: ['entry'],
        additionalProperties: true,
      },
      params: { type: 'object' },
    },
    required: ['premise', 'theme', 'tone', 'endings', 'cast', 'signals', 'outline', 'golden_rules', 'warmup'],
    additionalProperties: true,
  },
};

async function appendGenLog(stage, payload) {
  if (GEN_LOG_DISABLED) return;
  try {
    await fs.mkdir(GEN_LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString();
    let body;
    if (typeof payload === 'string') {
      body = payload;
    } else {
      try {
        body = JSON.stringify(payload, null, 2);
      } catch {
        body = String(payload);
      }
    }
    const entry = `[${stamp}] [${stage}]\n${body}\n\n`;
    await fs.appendFile(GEN_LOG_PATH, entry, 'utf-8');
  } catch (err) {
    console.warn(`[gen] failed to write log (${stage}): ${err.message}`);
  }
}

function slugifyLite(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getPrimaryBranchSlug(plan) {
  const raw =
    plan?.params?.primaryBranchSlug ||
    plan?.params?.playerBriefTag ||
    plan?.title ||
    plan?.premise ||
    'branch';
  return slugifyLite(raw) || 'branch';
}

function getPrimaryBranchLabel(plan) {
  return (
    plan?.params?.primaryBranchLabel ||
    plan?.params?.playerBriefTag ||
    plan?.title ||
    'Follow the lead'
  );
}

function getRuntimeOptionLabel(plan) {
  return plan?.params?.runtimeOptionLabel || 'Review case files';
}

const FALLBACK_PLAN = (seed = { tag: 'Default Premise', line: 'A rookie attorney takes on a messy high-profile case.' }) => ({
  title: 'Story Lab Draft',
  premise: seed.line,
  theme: 'Justice versus loyalty',
  tone: 'Tense courtroom mystery',
  endings: [
    'Client fully acquitted and the real culprit exposed',
    'Mistrial that uncovers a deeper conspiracy',
    'Client walks free but MC sacrifices their license to protect a witness',
  ],
  cast: [
    {
      id: 'mc',
      name: 'Rookie Attorney',
      goals: ['Clear the client', 'Prove their worth'],
      flaws: ['Inexperienced', 'Acts on instinct'],
      tags: ['Advocate', 'Observant'],
    },
    {
      id: 'client',
      name: 'Key Witness',
      goals: ['Avoid prison', 'Keep a sibling safe'],
      flaws: ['Secretive', 'Panics under pressure'],
      tags: ['Musician', 'Reluctant ally'],
    },
  ],
  signals: {
    credibility: { min: 0, max: 100, default: 50, desc: 'How compelling your argument sounds to the court' },
    suspicion: { min: 0, max: 100, default: 40, desc: 'How much suspicion still hangs over the client' },
  },
  outline: [
    'Emergency arraignment throws MC into a crowded courthouse',
    'Collect statements and uncover inconsistencies',
    'Run a mock cross-exam to stress-test alibis',
    'Expose the hidden motive before the main hearing',
    'Deliver the decisive argument and face the verdict',
  ],
  golden_rules: [
    'Only output WebGAL lines ending with a semicolon.',
    `Each slice must contain ${SLICE_MIN_LINES}-${SLICE_MAX_LINES} lines and end with choose: or end;.`,
    'Choices must reference runtime/<arc>/<node>.txt targets and feel grounded in modern settings.',
  ],
  warmup: { entry: 'act-1/entry', depth: 2 },
  params: {
    difficulty: 'normal',
    playerBrief: seed.raw || USER_BRIEF || '',
    playerBriefExpanded: seed.line,
    playerBriefTag: seed.tag,
    primaryBranchSlug: slugifyLite(seed.tag) || 'branch',
    primaryBranchLabel: seed.tag || 'Follow the lead',
    runtimeOptionLabel: 'Review case files',
  },
});

function buildFallbackStart(plan) {
  const label = getPrimaryBranchLabel(plan);
  const slug = getPrimaryBranchSlug(plan);
  const runtimeLabel = getRuntimeOptionLabel(plan);
  return [
    `intro:Breaking news banners flood the district courthouse lobby|Your client’s arraignment moves up without warning;`,
    ':You steady your case files as live cameras pan across your face;',
    ':Prosecutor Victoria Lee smirks from the marble staircase, daring you to falter;',
    `choose:${runtimeLabel}:runtime/act-1/entry.txt|Chase the ${label} lead:chapter_01/${slug}.txt;`,
  ].join('\n');
}

function buildFallbackBranch(plan) {
  const label = getPrimaryBranchLabel(plan);
  const slug = getPrimaryBranchSlug(plan);
  return [
    `intro:${label} drags you into a cramped rehearsal room behind the courtroom;`,
    ':The witness wrings their hands while neon signage flickers through the blinds;',
    ':You promise confidentiality even as a bailiff pounds on the door for updates;',
    `choose:Return to courthouse hub:runtime/act-1/entry.txt|Press the ${label} lead further:chapter_01/${slug}.txt;`,
  ].join('\n');
}

async function ensureDirs() {
  const need = [
    'scene',
    'scene/chapter_01',
    'background',
    'figure',
    'bgm',
    'vocal',
    'video',
    'tex',
    'story',
  ];
  for (const rel of need) {
    await fs.mkdir(path.join(GAME_ROOT, rel), { recursive: true });
  }
}

function stripFence(raw) {
  return (raw || '').replace(/```json|```/gi, '').trim();
}
function safeParseJSON(raw) {
  const txt = stripFence(raw);
  try {
    return JSON.parse(txt);
  } catch (err) {
    throw new Error('Failed to parse JSON returned by the LLM');
  }
}

const WEBGAL_EXAMPLE = `<example>
intro:Sensor sweep paints the atrium in cold violet light;
:MC:I tag the suspect avatar and mirror their biometrics;
:setVar:System_Integrity=System_Integrity-5;
choose:Trace the signal:runtime/act-1/trace.txt|Flag the judge:runtime/act-1/report.txt;
</example>`;

const WS_OUTPUT_POLICY = `Output requirements:
- Only emit WebGAL script lines; every line must end with ';'. Do not include explanations, Markdown, JSON, code blocks, or blank lines.
- Each slice must contain exactly ${SLICE_MIN_LINES}~${SLICE_MAX_LINES} lines. The final line must be choose:…; (two runtime targets) or end; (only if the outline allows a finale). All other lines must advance action/dialog/narration/setVar rather than summarizing.
- Do not end the scene early before reaching ${SLICE_MAX_LINES} lines. Each non-final line must describe concrete actions, sensations, or emotions - never recap previous slices.
- choose lines must contain two semantically different options and target files under runtime/<arc>/<node>.txt.
- choose lines must follow \`choose:LabelA:runtime/arc/node.txt|LabelB:runtime/arc/node.txt;\` exactly - no quotes, extra semicolons, or line breaks.
- Use ASCII punctuation only (no Chinese punctuation marks).
${WEBGAL_EXAMPLE}`;

const WEBGAL_RULES = `
You must generate a WebGAL script (ws).
${WS_OUTPUT_POLICY}
Examples:
  Narration:  :The corridor tastes of ozone;
  Dialogue:   Character:One short line;
  Choice:     choose:Investigate lab:chapter_01/lab.txt|Retreat:home;
  Labels:     label:home; / jumpLabel:home;
  Ending:     end;`;

function sanitizeWs(raw) {
  if (!raw) return '';
  const noFence = String(raw).replace(/```[\s\S]*?```/g, ' ');
  const lines = noFence
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const kept = [];
  for (const line of lines) {
    if (line === 'end;' || line.includes(':')) {
      kept.push(line);
    }
  }
  return kept.join('\n');
}

const EXPAND_MIN_CHARS = Number(process.env.GEN_EXPAND_MIN_CHARS ?? 12);
const EXPAND_TIMEOUT_MS = Number(process.env.GEN_EXPAND_TIMEOUT_MS ?? 4000);

const EXPAND_JSON_SCHEMA = {
  name: 'brief_expand',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      tag: { type: 'string', description: 'Genre or tag phrase' },
      line: { type: 'string', description: 'Single-sentence hook' },
    },
    required: ['tag', 'line'],
    additionalProperties: false,
  },
};

async function expandBrief(text) {
  if (!HAS_LLM) return null;
  const prompt = `
You are a genre pitch editor. The player wrote: "${text}".
Infer a marketable genre tag and a concrete one-line hook the team can build on.
Output JSON only: {"tag":"...","line":"..."}
`;
  try {
    await appendGenLog('brief.expand.request', {
      model: WRITE_MODEL,
      temperature: WRITE_TEMPERATURE,
      top_p: 0.9,
      response_format: { type: 'json_schema', json_schema: EXPAND_JSON_SCHEMA },
      messages: [
        { role: 'system', content: 'Output JSON only. No explanations.' },
        { role: 'user', content: prompt },
      ],
    });
    const { content, raw } = await callChatCompletion({
      model: WRITE_MODEL,
      temperature: WRITE_TEMPERATURE,
      top_p: 0.9,
      response_format: { type: 'json_schema', json_schema: EXPAND_JSON_SCHEMA },
      messages: [
        { role: 'system', content: 'Output JSON only. No explanations.' },
        { role: 'user', content: prompt },
      ],
    });
    const trimmed = (content || '').trim();
    await appendGenLog('brief.expand.response', {
      id: raw?.id,
      model: raw?.model,
      usage: raw?.usage,
      finish_reason: raw?.choices?.[0]?.finish_reason,
      content: trimmed,
    });
    const parsed = JSON.parse(trimmed);
    if (parsed?.tag && parsed?.line) {
      return { tag: parsed.tag.trim(), line: parsed.line.trim() };
    }
  } catch (err) {
    console.warn(`[gen] Failed to expand brief: ${err.message}`);
    await appendGenLog('brief.expand.error', {
      message: err?.message,
      name: err?.name,
    });
  }
  return null;
}

async function buildSeed(userBrief) {
  const txt = userBrief && userBrief.trim();
  if (txt) {
    const needExpand =
      txt.length < EXPAND_MIN_CHARS ||
      txt.split(/[，,。\s]/).filter(Boolean).length <= 3;
    if (needExpand && HAS_LLM) {
      const expanded = await expandBrief(txt);
      if (expanded) {
        return { ...expanded, raw: txt };
      }
    }
    return { tag: 'Player Preference', line: txt, raw: txt };
  }
  const pick = SEED_BANK[Math.floor(Math.random() * SEED_BANK.length)];
  return { ...pick, raw: '' };
}

function buildPlayerDirectiveBlock() {
  const directives = [];
  if (USER_TITLE) {
    directives.push(`- Player requested title or theme: ${USER_TITLE}`);
  }
  if (USER_BRIEF) {
    directives.push(`- Player described style/elements: ${USER_BRIEF}`);
  }
  if (directives.length === 0) {
    return '';
  }
  return `<player_directives>
${directives.join('\n')}
</player_directives>`;
}

function mkPlanBrainstormPrompt(seed) {
  const directiveBlock = buildPlayerDirectiveBlock();
  return `
<role>You are Gemini 2.5 weaving high-value brainstorming notes for a visual novel. Another model will later structure the plan.</role>
<task>
Genre/Hook: ${seed.tag} | ${seed.line}
</task>
${directiveBlock || ''}
<objective>
Write in English paragraphs and bulleted lists covering: Premise/Hook, Theme & Tone, Cast (id / traits / goals / flaws / signals), Signals (ranges, defaults, trigger notes), Outline (>=5 beats with twists and branch hooks), Golden Rules (world + writing constraints), optional params/warmup ideas.
</objective>
<rules>
- Think aloud then summarize; do not output JSON, tables, or Markdown fences.
- Provide at least 3 ending paths with their risks/sacrifices.
- Flag clues suited for runtime/AI branches so later choose:runtime/... targets are obvious.
</rules>
`;
}

function mkPlanStructPrompt(notes) {
  const cleaned = (notes || '').trim();
  const directiveBlock = buildPlayerDirectiveBlock();
  return `
<instructions>
You will receive raw brainstorming notes. Restructure them into JSON only (no prose or Markdown). Required keys:
- premise, theme, tone
- endings[] (>=3)
- cast[] {id,name,goals[],flaws[],tags[]}
- signals object (key:{min,max,default,desc}; default optional; stay faithful to notes or reasoned assumptions)
- outline[] (5-8 steps that reach the end)
- golden_rules[] (>=3 covering voice/world/tech constraints)
- warmup {entry, depth} (entry must be act-1/entry; depth defaults to 2 if missing)
- params (optional custom config)
</instructions>
<additional_requirements>
- The plan must be ready for WebGAL runtime. Signals must support setVar increases/decreases.
- Do not omit required keys; use empty arrays/objects when data is missing.
</additional_requirements>
${directiveBlock || ''}
<brainstorm_notes>
${cleaned}
</brainstorm_notes>
<output_format>Output JSON only.</output_format>
`;
}

function planSummary(plan) {
  const outline = Array.isArray(plan.outline) ? plan.outline.join(' / ') : '';
  const cast =
    Array.isArray(plan.cast) && plan.cast.length > 0
      ? plan.cast.map((c) => `${c.name || c.id}:${(c.tags || []).join('/')}`).join(' | ')
      : '';
  const sections = [];
  if (plan.title) {
    sections.push(`Title: ${plan.title}`);
  }
  sections.push(`Premise: ${plan.premise || ''}`);
  sections.push(`Tone: ${plan.tone || ''}`);
  if (outline) {
    sections.push(`Outline: ${outline}`);
  }
  if (cast) {
    sections.push(`Cast: ${cast}`);
  }
  const playerNeed = plan?.params?.playerBriefExpanded || plan?.params?.playerBrief;
  if (playerNeed) {
    sections.push(`Player input: ${playerNeed}`);
  }
  return sections.join('\n');
}

function mkStartPrompt(plan) {
  const branchLabel = getPrimaryBranchLabel(plan);
  const branchSlug = getPrimaryBranchSlug(plan);
  const runtimeLabel = getRuntimeOptionLabel(plan);
  return `
<instructions>
You are a WebGAL scene author. Output WebGAL text only.
${WEBGAL_RULES}
</instructions>

<background>
${planSummary(plan)}
signals: ${JSON.stringify(plan.signals ?? {})}
</background>

<detailed_task>
Write scene/start.txt with ~2-3 minutes of pacing:
- The first line must be intro: ...; you may use | to split multiple black-screen beats.
- Include at least one choose line. One option must jump to runtime/act-1/entry.txt with a setting-appropriate label (use "${runtimeLabel}" as inspiration, but keep it diegetic).
- The other option must lead to chapter_01/${branchSlug}.txt with a label that matches "${branchLabel}".
- Use all ${SLICE_MIN_LINES}~${SLICE_MAX_LINES} lines to deliver concrete sensory detail, actions, or emotions - never recap previous slices.
- Keep the requested tone throughout; do not drift off-topic just to fill lines.
The last line must be choose:...; or end;.
</detailed_task>

<output_format>Output WebGAL script only.</output_format>
`;
}

function mkOldTownPrompt(plan) {
  const branchLabel = getPrimaryBranchLabel(plan);
  const branchSlug = getPrimaryBranchSlug(plan);
  return `
<instructions>
You are a WebGAL scene author. Output WebGAL text only.
${WEBGAL_RULES}
</instructions>

<background>
${planSummary(plan)}
signals: ${JSON.stringify(plan.signals ?? {})}
</background>

<detailed_task>
Write scene/chapter_01/${branchSlug}.txt following the "${branchLabel}" branch from start.txt:
- Introduce at least one key NPC.
- Include at least one choose line (jump to end; or further chapter_01/... nodes).
- Show why this location is dangerous or conspiratorial and leave a hook.
- Use ${SLICE_MIN_LINES}~${SLICE_MAX_LINES} detailed lines; every non-final line must show action, setting, or emotion.
- If this branch will adjust signals later, foreshadow which setVar calls will appear in the next slice.
The final line must be choose:...; or end;.
</detailed_task>

<output_format>Output WebGAL script only.</output_format>
`;
}

async function chat(
  model,
  messages,
  { temperature = 0.7, top_p, response_format, max_output_tokens, logLabel, reasoning } = {},
) {
  if (!HAS_LLM) {
    throw new Error('LLM client is not configured');
  }
  const logStage = logLabel || 'chat';
  await appendGenLog(`${logStage}.request`, {
    model,
    temperature,
    top_p,
    response_format,
    max_output_tokens,
    reasoning,
    messages,
  });
  let result;
  try {
    result = await callChatCompletion({
      model,
      messages,
      temperature,
      top_p,
      response_format,
      max_tokens: max_output_tokens,
      reasoning,
    });
  } catch (err) {
    await appendGenLog(`${logStage}.error`, {
      message: err?.message,
      stack: err?.stack,
    });
    throw err;
  }
  const { content = '', reasoning: reasoningText = '', raw } = result || {};
  await appendGenLog(`${logStage}.response`, {
    id: raw?.id,
    model: raw?.model,
    usage: raw?.usage,
    finish_reason: raw?.choices?.[0]?.finish_reason,
    content: content || '',
    reasoning: reasoningText,
  });
  return [reasoningText, content].filter((part) => part && part.trim().length > 0).join('\n').trim();
}

async function brainstormPlanNotes(seed) {
  const prompt = mkPlanBrainstormPrompt(seed);
  return chat(
    THINK_MODEL,
    [
      { role: 'system', content: 'You are Gemini 2.5 drafting detailed narrative brainstorming notes in English. Do not output JSON.' },
      { role: 'user', content: prompt },
    ],
    {
      temperature: THINK_TEMPERATURE,
      top_p: 0.9,
      logLabel: 'plan.brainstorm',
    },
  );
}

async function structurePlanFromNotes(notes) {
  const prompt = mkPlanStructPrompt(notes);
  const txt = await chat(
    WRITE_MODEL,
    [
      { role: 'system', content: 'You are a structural narrative engineer; output JSON only.' },
      { role: 'user', content: prompt },
    ],
    {
      temperature: STRUCT_TEMPERATURE,
      top_p: 0.85,
      logLabel: 'plan.structure',
      response_format: {
        type: 'json_schema',
        json_schema: PLAN_JSON_SCHEMA,
      },
    },
  );
  try {
    return safeParseJSON(txt);
  } catch (err) {
    const preview = (txt || '').trim();
    console.warn('[gen] plan JSON parse failed, preview:', preview.slice(0, 600));
    await appendGenLog('plan.structure.parse_error', {
      preview: preview.slice(0, 600),
      message: err?.message,
    });
    if (preview.length > 0) {
      try {
        const dumpDir = path.join(GAME_ROOT, 'story');
        await fs.mkdir(dumpDir, { recursive: true });
        const dumpPath = path.join(dumpDir, `plan_raw_${Date.now()}.txt`);
        await fs.writeFile(dumpPath, preview, 'utf-8');
        console.warn('[gen] raw plan response saved to', dumpPath);
        await appendGenLog('plan.structure.raw_dump', { path: dumpPath });
      } catch (writeErr) {
        console.warn('[gen] failed to dump raw plan response:', writeErr.message);
      }
    }
    throw err;
  }
}

async function writeWS(prompt, logLabel = 'ws') {
  const txt = await chat(
    WRITE_MODEL,
    [
      { role: 'system', content: 'Output WebGAL script text only. Every line must end with a semicolon. No explanations.' },
      { role: 'user', content: prompt },
    ],
    {
      temperature: WRITE_TEMPERATURE,
      top_p: 0.9,
      logLabel,
    },
  );
  return sanitizeWs(txt);
}

async function generatePlan() {
  const seed = await buildSeed(USER_BRIEF);
  await appendGenLog('plan.seed', seed);
  if (!HAS_LLM) {
    const fallback = FALLBACK_PLAN(seed);
    await fs.writeFile(PLAN_PATH, JSON.stringify(fallback, null, 2), 'utf-8');
    await appendGenLog('plan.generate.fallback', {
      reason: 'LLM not configured',
      path: PLAN_PATH,
    });
    return fallback;
  }

  try {
    const notes = await brainstormPlanNotes(seed);
    const plan = await structurePlanFromNotes(notes);
    plan.title = plan.title || USER_TITLE || plan.premise;
    const primaryBranchLabel =
      plan.params?.primaryBranchLabel ||
      (seed.tag ? `Explore ${seed.tag}` : 'Explore the unknown');
    const primaryBranchSlug =
      plan.params?.primaryBranchSlug || slugifyLite(primaryBranchLabel) || 'branch';
    const secondaryBranchLabel =
      plan.params?.secondaryBranchLabel ||
      plan.params?.runtimeOptionLabel ||
      'Secondary Lead';
    const secondaryBranchSlug =
      plan.params?.secondaryBranchSlug ||
      slugifyLite(secondaryBranchLabel) ||
      'secondary-lead';
    const primaryRuntimeSeeds =
      plan.params?.primaryRuntimeSeeds || getRuntimeSeedsForBranch(primaryBranchSlug);
    const secondaryRuntimeSeeds =
      plan.params?.secondaryRuntimeSeeds || getRuntimeSeedsForBranch(secondaryBranchSlug);
    plan.params = {
      ...(plan.params || {}),
      playerBrief: seed.raw || USER_BRIEF || plan.params?.playerBrief || '',
      playerBriefExpanded: seed.line,
      playerBriefTag: seed.tag,
      playerTitle: USER_TITLE || plan.params?.playerTitle || '',
      primaryBranchSlug,
      primaryBranchLabel,
      secondaryBranchSlug,
      secondaryBranchLabel,
      primaryRuntimeSeeds,
      secondaryRuntimeSeeds,
    };
    const warmupDepth = plan.warmup?.depth ?? 2;
    const currentWarmupEntry = (plan.warmup?.entry || '').trim();
    const primarySeedEntry = `act-1/${primaryRuntimeSeeds[0]}`;
    const resolvedWarmupEntry =
      !currentWarmupEntry || currentWarmupEntry === 'act-1/entry'
        ? primarySeedEntry
        : currentWarmupEntry;
    plan.warmup = { entry: resolvedWarmupEntry, depth: warmupDepth };
    await fs.writeFile(PLAN_PATH, JSON.stringify(plan, null, 2), 'utf-8');
    await appendGenLog('plan.generate.success', {
      path: PLAN_PATH,
      title: plan.title,
      slug: GAME_SLUG,
    });
    return plan;
  } catch (err) {
    console.warn(`[gen] Failed to build plan.json, using fallback: ${err.message}`);
    await appendGenLog('plan.generate.error', { message: err?.message });
    const fallback = FALLBACK_PLAN(seed);
    if (USER_TITLE) {
      fallback.title = USER_TITLE;
    }
    await fs.writeFile(PLAN_PATH, JSON.stringify(fallback, null, 2), 'utf-8');
    await appendGenLog('plan.generate.fallback', {
      reason: err?.message,
      path: PLAN_PATH,
    });
    return fallback;
  }
}

async function genStart(plan) {
  const target = path.join(GAME_ROOT, 'scene', 'start.txt');
  if (!HAS_LLM) {
    await fs.writeFile(target, buildFallbackStart(plan), 'utf-8');
    await appendGenLog('scene.start.fallback', { reason: 'LLM not configured', target });
    return;
  }
  try {
    const txt = await writeWS(mkStartPrompt(plan), 'scene.start');
    const finalText = txt && txt.trim().length > 0 ? txt.trim() : buildFallbackStart(plan);
    await fs.writeFile(target, finalText, 'utf-8');
    await appendGenLog('scene.start.success', { target, usedLLM: true, usedFallback: !txt });
  } catch (err) {
    console.warn(`[gen] Failed to build start.txt, using fallback script: ${err.message}`);
    await appendGenLog('scene.start.error', { message: err?.message });
    await fs.writeFile(target, buildFallbackStart(plan), 'utf-8');
  }
}

async function genOldTown(plan) {
  const branchSlug = getPrimaryBranchSlug(plan);
  const target = path.join(GAME_ROOT, 'scene', 'chapter_01', `${branchSlug}.txt`);
  if (!HAS_LLM) {
    await fs.writeFile(target, buildFallbackBranch(plan), 'utf-8');
    await appendGenLog('scene.branch.fallback', { reason: 'LLM not configured', target });
    return;
  }
  try {
    const txt = await writeWS(mkOldTownPrompt(plan), 'scene.branch');
    const finalText = txt && txt.trim().length > 0 ? txt.trim() : buildFallbackBranch(plan);
    await fs.writeFile(target, finalText, 'utf-8');
    await appendGenLog('scene.branch.success', { target, usedLLM: true, usedFallback: !txt });
  } catch (err) {
    console.warn(`[gen] Failed to build branch scene, using fallback script: ${err.message}`);
    await appendGenLog('scene.branch.error', { message: err?.message });
    await fs.writeFile(target, buildFallbackBranch(plan), 'utf-8');
  }
}

(async () => {
  await ensureDirs();
  const plan = await generatePlan();
  await genStart(plan);
  await genOldTown(plan);
  console.log(`✅ Generated files at: ${PLAN_PATH}`);
  await appendGenLog('done', { planPath: PLAN_PATH, slug: GAME_SLUG });
})();
