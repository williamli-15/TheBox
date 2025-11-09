const express = require('express');
const Cloudlog = require("cloudlogjs");
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const rl = require('readline');
const open = require('open');
const { execFile } = require('child_process');
const { randomUUID } = require('crypto');
const { callChatCompletion, hasLLMProvider } = require('./llmClient');
const runtimeWindow = require('./runtimeWindow');
const { getPlan, invalidatePlan } = require('./storyPlan');

// 读取控制台输入
const readline = rl.createInterface({
    input: process.stdin,
    output: process.stdout
})

const server = new express();
const Port = process.env.PORT || 3000;
const logger = new Cloudlog();
const repoRoot = path.resolve(__dirname, '..', '..');
const publicGamesDir = path.join(repoRoot, 'packages/webgal/public/games');
const GEN_SCRIPT_PATH = path.join(repoRoot, 'scripts', 'gen.mjs');
const DEFAULT_COVER_PATH = 'games/defaultgame/background/WebGalEnter.webp';
const bootstrapTasks = new Map();
const SESSION_HEADER = 'X-WebGAL-Session';
const SESSION_COOKIE = 'webgal_sid';
const DEFAULT_SESSION = 'default';
let webgalWd = '';

if (!fs.existsSync(publicGamesDir)) {
    fs.mkdirSync(publicGamesDir, { recursive: true });
}

const IDEA_MODEL =
    process.env.LLM_IDEA_MODEL ||
    process.env.LLM_WRITE_MODEL ||
    'google/gemini-2.5-flash';
const IDEA_TEMPERATURE = Number(process.env.LLM_IDEA_TEMPERATURE ?? 1.05);
const IDEA_JSON_SCHEMA = {
    name: 'webgal_idea',
    strict: true,
    schema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Concise hooky title' },
            brief: { type: 'string', description: 'One-sentence genre hook' },
        },
        required: ['title', 'brief'],
        additionalProperties: false,
    },
};

server.use(express.json({ limit: '1mb' }));

server.use(
    '/games',
    express.static(publicGamesDir, {
        etag: false,
        lastModified: false,
        maxAge: 0,
        fallthrough: true,
    }),
);

const runtimeSliceRoute = /^\/games\/([^/]+)\/scene\/runtime\/(.+\.txt)$/;

function hasPlan(dir) {
    return dir && fs.existsSync(path.join(dir, 'story', 'plan.json'));
}

function resolveGameDir(slug) {
    const normalized = (slug || '').toLowerCase();
    if (!normalized) {
        return null;
    }
    const fromRepoPublic = path.join(publicGamesDir, normalized);
    if (hasPlan(fromRepoPublic)) {
        return fromRepoPublic;
    }

    if (webgalWd) {
        const guessPublic = path.join(webgalWd, 'public', 'games', normalized);
        if (hasPlan(guessPublic)) {
            return guessPublic;
        }
        const guessRoot = path.join(webgalWd, 'games', normalized);
        if (hasPlan(guessRoot)) {
            return guessRoot;
        }
    }

    if (fs.existsSync(fromRepoPublic)) {
        return fromRepoPublic;
    }
    return null;
}

function normalizeSliceId(value) {
    if (!value || typeof value !== 'string') return null;
    let normalized = value.trim();
    if (!normalized) return null;
    normalized = normalized.replace(/^runtime\//, '').replace(/\.txt$/, '');
    if (!normalized.includes('/')) {
        normalized = `act-1/${normalized}`;
    }
    return normalized;
}

function collectWarmupSliceIds(plan) {
    const result = [];
    const seen = new Set();
    const push = (value) => {
        const normalized = normalizeSliceId(value);
        if (normalized && !seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    };
    push(plan?.warmup?.entry);
    const primarySeeds = Array.isArray(plan?.params?.primaryRuntimeSeeds)
        ? plan.params.primaryRuntimeSeeds
        : [];
    const secondarySeeds = Array.isArray(plan?.params?.secondaryRuntimeSeeds)
        ? plan.params.secondaryRuntimeSeeds
        : [];
    for (const seed of [...primarySeeds, ...secondarySeeds]) {
        if (!seed || typeof seed !== 'string') continue;
        const trimmed = seed.trim();
        if (!trimmed) continue;
        if (trimmed.includes('/')) {
            push(trimmed);
        } else {
            push(`act-1/${trimmed}`);
        }
    }
    if (result.length === 0) {
        push('act-1/entry');
    }
    return result;
}

server.get('/api/games', async (req, res) => {
    try {
        const games = await listPublishedGames();
        return res.json({ ok: true, games });
    } catch (err) {
        logger.error(`[games] failed to enumerate games`, err);
        return res.status(500).json({ ok: false, error: err.message || 'failed to enumerate games' });
    }
});

server.get(runtimeSliceRoute, async (req, res) => {
    const gameSlug = (req.params[0] || '').toLowerCase();
    const slicePath = req.params[1];
    const sliceId = slicePath.replace(/\.txt$/, '');
    const gameDir = resolveGameDir(gameSlug);
    const sessionId = ensureSessionId(req, res);
    try {
        const script = await runtimeWindow.ensureSlice(gameSlug, sliceId, { gameDir, sid: sessionId });
        if (!script) {
            logger.warn(`运行时切片 ${gameSlug}/${sliceId} 未返回内容`);
            return res.status(404).type('text/plain; charset=utf-8').send(`;runtime slice ${sliceId} missing;\nend;`);
        }
        res.setHeader(SESSION_HEADER, sessionId);
        return res.type('text/plain; charset=utf-8').send(script);
    } catch (err) {
        logger.error(`生成运行时切片 ${gameSlug}/${sliceId} 失败`, err);
        return res.status(500).type('text/plain; charset=utf-8').send(`;runtime slice ${sliceId} error;\nend;`);
    }
});

server.post('/api/lobby/bootstrap', async (req, res) => {
    if (!webgalWd) {
        return res.status(503).json({ ok: false, error: 'WebGAL 工作目录未初始化' });
    }
    const sessionId = ensureSessionId(req, res);
    const rawSlug = typeof req.body?.slug === 'string' ? req.body.slug : '';
    const requestedTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const requestedBrief = typeof req.body?.brief === 'string' ? req.body.brief.trim() : '';
    let slug = '';
    if (rawSlug.trim().length > 0) {
        slug = sanitizeSlug(rawSlug);
        if (!slug) {
            return res.status(400).json({ ok: false, error: 'slug 无效' });
        }
    } else {
        slug = createUniqueSlug(requestedTitle || 'story');
    }

    let task = bootstrapTasks.get(slug);
    if (!task) {
        task = (async () => {
            try {
                const { entry, depth, title } = await bootstrapGame(slug, {
                    title: requestedTitle,
                    prompt: requestedBrief,
                    sessionId,
                });
                return { ok: true, slug, entry: `runtime/${entry}.txt`, depth, title };
            } finally {
                bootstrapTasks.delete(slug);
            }
        })();
        bootstrapTasks.set(slug, task);
    }
    try {
        const result = await task;
        res.setHeader(SESSION_HEADER, sessionId);
        return res.json({ ...result, sessionId });
    } catch (err) {
        logger.error(`[bootstrap] failed for ${slug}`, err);
        return res.status(500).json({ ok: false, error: err.message || 'bootstrap failed' });
    }
});

server.post('/api/lobby/idea', async (req, res) => {
    try {
        if (!hasLLMProvider) {
            return res.status(503).json({ ok: false, error: 'LLM provider is not configured' });
        }
        const hints = typeof req.body?.hints === 'string' ? req.body.hints.slice(0, 300) : '';
        const { content } = await callChatCompletion({
            model: IDEA_MODEL,
            temperature: IDEA_TEMPERATURE,
            response_format: {
                type: 'json_schema',
                json_schema: IDEA_JSON_SCHEMA,
            },
            messages: [
                {
                    role: 'system',
                    content: 'You are a genre inspiration dice. Output JSON only (title + one-line hook) with no extra text.',
                },
                {
                    role: 'user',
                    content: `Generate a live2d / Danganronpa-style courtroom / social deduction visual-novel title and one-line hook for North American players, using the player's hints: ${
                        hints || 'free inspiration.'
                    } Return JSON with exactly these keys: {"title":"...", "brief":"..."}. "brief" must be the one-line hook. The title must contain 8-12 English words. The hook must be fluent English and clearly state the protagonist, core conflict, or investigation hook. Avoid wasteland/post-apocalyptic/mecha topics unless the player explicitly asks; favor urban, campus, near-future courtroom, or social deduction arenas. Never output ads or multi-language mixes.`,
                },
            ],
        });
        const clean = (content || '').replace(/```json|```/gi, '').trim();
        const txt = clean.length > 0 ? clean : '{}';
        let idea = null;
        try {
            idea = JSON.parse(txt);
        } catch (err) {
            logger.warn(`[idea] JSON parse error, raw response: ${txt}`);
            return res.status(500).json({ ok: false, error: 'IDEA_JSON_PARSE_ERROR' });
        }
        if (!idea?.title || !idea?.brief) {
            logger.warn(`[idea] JSON invalid (missing fields), raw response: ${txt}`);
            return res.status(500).json({ ok: false, error: 'IDEA_JSON_INVALID' });
        }
        res.json({ ok: true, idea });
    } catch (err) {
        logger.warn(`[idea] failed: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message || 'idea failed' });
    }
});

// 读取控制台数据
const args = process.argv;
logger.info(`WebGAL Server 启动参数：`, args);

// 读取工作目录
const cwd = process.cwd();
logger.info(`WebGAL 工作目录当前为 ${cwd}`);

// 参数模式
if (args.length >= 3) {
    // 参数就是工作目录
    const wdr = args[2];
    logger.info(`指定工作目录：${wdr}`);
    if (wdr[0] === '/' || wdr.match(/^\w:/)) {
        // 绝对路径模式
        logger.debug('绝对路径模式');
        webgalWd = wdr;
    } else {
        // 相对路径模式
        logger.debug('相对路径模式');
        const rwd = wdr.split(/[\\\/]/g);
        webgalWd = path.join(cwd, ...rwd);
    }
    // 输出
    logger.info(`工作目录被设置为 ${webgalWd}`);
}

// 自动探测模式
if (webgalWd === '') {
    const dirInfo = fs.readdirSync(cwd);
    if (dirInfo.includes('index.html')) {
        logger.info(`在当前工作目录下启动 WebGAL`);
        webgalWd = cwd;
    } else {
        // 全转成大写，复制一份副本
        const dirInfoUpperCase = dirInfo.map(e => e.toUpperCase());
        if (dirInfoUpperCase.includes('WEBGAL')) {
            // 找 index
            const index = dirInfoUpperCase.findIndex(e => e === 'WEBGAL');
            const trueDirName = dirInfo[index];
            webgalWd = path.join(cwd, trueDirName);
        } else {
            // 没找到
            logger.info(`未找到 WebGAL 文件，请在 WebGAL 项目目录下启动 WebGAL-Server 或在本目录下的 WebGAL 文件夹下启动。`);
        }
    }
}

if (webgalWd) {
    // 监听端口
    server.use(express.static(webgalWd))//allow browser access resources
    server.listen(Port, () => {
        logger.info(`启动 WebGAL 服务器，运行于 http://localhost:${Port} .`)
        if (process.env.WEBGAL_RUNTIME_WARMUP === 'true') {
            warmupRuntime().catch((err) => logger.warn(`[warmup] failed: ${err.message}`));
        }
    })
    open(`http://localhost:${Port}`);
} else {
    logger.error(`未找到启动文件，请退出`);
    readline.on('line', () => {
        process.exit();
    })
}

async function warmupRuntime() {
    const candidates = Array.from(
        new Set(
            [
                publicGamesDir,
                webgalWd ? path.join(webgalWd, 'public', 'games') : null,
                webgalWd ? path.join(webgalWd, 'games') : null,
            ].filter(Boolean),
        ),
    );
    for (const base of candidates) {
        if (!fs.existsSync(base)) continue;
        const slugs = fs
            .readdirSync(base)
            .filter((slug) => fs.existsSync(path.join(base, slug, 'story', 'plan.json')));
        for (const slug of slugs) {
            const gameDir = path.join(base, slug);
            const plan = getPlan(gameDir);
            const depth = plan?.warmup?.depth ?? 2;
            const sliceIds = collectWarmupSliceIds(plan);
            for (const sliceId of sliceIds) {
                logger.info(`[warmup] 预取 ${slug} runtime/${sliceId}.txt depth=${depth}`);
                await runtimeWindow.ensureSlice(slug, sliceId, {
                    gameDir,
                    prefetch: true,
                    depth,
                    sid: `warmup-${slug}`,
                });
            }
        }
    }
}

async function bootstrapGame(slug, options = {}) {
    logger.info(`[bootstrap] 触发 ${slug} 内容生成`);
    await runGeneratorForSlug(slug, options);
    const gameDir = resolveGameDir(slug);
    if (!gameDir) {
        throw new Error(`无法确定 ${slug} 的游戏目录`);
    }
    invalidatePlan(gameDir);
    const plan = getPlan(gameDir);
    const meta = await writeGameMeta(slug, plan, options, gameDir);
    const depth = plan?.warmup?.depth ?? 2;
    const warmupSession = options.sessionId || `bootstrap-${slug}`;
    const sliceIds = collectWarmupSliceIds(plan);
    const entry = sliceIds[0] || 'act-1/entry';
    for (const sliceId of sliceIds) {
        logger.info(
            `[bootstrap] 预取 ${slug} runtime/${sliceId}.txt depth=${depth} sid=${warmupSession}`,
        );
        await runtimeWindow.ensureSlice(slug, sliceId, {
            gameDir,
            prefetch: true,
            depth,
            sid: warmupSession,
        });
    }
    const derivedTitle =
        meta?.name ||
        plan?.title ||
        options.title ||
        plan?.premise ||
        slug;
    return { entry, depth, title: derivedTitle, cover: meta?.cover };
}

function runGeneratorForSlug(slug, options = {}) {
    if (!fs.existsSync(GEN_SCRIPT_PATH)) {
        throw new Error(`找不到生成脚本：${GEN_SCRIPT_PATH}`);
    }
    const generatorEnv = {
        ...process.env,
        GAME_SLUG: slug,
    };
    if (options.title) {
        generatorEnv.GEN_USER_TITLE = options.title;
    }
    if (options.prompt) {
        generatorEnv.GEN_USER_BRIEF = options.prompt;
    }
    return new Promise((resolve, reject) => {
        logger.info(`[bootstrap] 执行 gen.mjs (slug=${slug})`);
        const child = execFile(
            process.execPath,
            [GEN_SCRIPT_PATH],
            {
                cwd: repoRoot,
                env: generatorEnv,
            },
            (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            },
        );
        if (child.stdout) {
            child.stdout.on('data', (chunk) => {
                const text = chunk.toString().trim();
                if (text) {
                    logger.debug(`[gen:${slug}] ${text}`);
                }
            });
        }
        if (child.stderr) {
            child.stderr.on('data', (chunk) => {
                const text = chunk.toString().trim();
                if (text) {
                    logger.warn(`[gen:${slug}] ${text}`);
                }
            });
        }
    });
}

async function writeGameMeta(slug, plan, options, gameDir) {
    const metaPath = path.join(publicGamesDir, slug, 'meta.json');
    try {
        await fsp.mkdir(path.dirname(metaPath), { recursive: true });
        const existing = await readJSONIfExists(metaPath);
        const now = new Date().toISOString();
        const meta = {
            slug,
            name: plan.title || options.title || existing?.name || plan.premise || slug,
            author: plan.params?.author || existing?.author || 'AI Runtime',
            cover: selectCoverPath(slug, gameDir, plan.params?.cover || existing?.cover),
            brief: plan.params?.playerBrief || options.prompt || existing?.brief || '',
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };
        await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
        return meta;
    } catch (err) {
        logger.warn(`[bootstrap] failed to write meta for ${slug}: ${err.message}`);
        return null;
    }
}

function selectCoverPath(slug, gameDir, preferred) {
  if (preferred) {
    return preferred;
  }
  const backgroundDir = path.join(gameDir, 'background');
    const candidates = ['cover.png', 'cover.jpg', 'cover.webp'];
  for (const file of candidates) {
    if (fs.existsSync(path.join(backgroundDir, file))) {
      return `games/${slug}/background/${file}`;
    }
  }
  return DEFAULT_COVER_PATH;
}

async function readJSONIfExists(filePath) {
    try {
        const raw = await fsp.readFile(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
}

async function listPublishedGames() {
    const results = [];
    const seen = new Set();
    try {
        const dirents = await fsp.readdir(publicGamesDir, { withFileTypes: true });
        for (const dirent of dirents) {
            if (!dirent.isDirectory()) continue;
            const slug = dirent.name;
            const meta = await loadGameMeta(slug);
            if (meta) {
                results.push(meta);
                seen.add(slug);
            }
        }
    } catch (err) {
        logger.warn(`[games] failed to scan ${publicGamesDir}: ${err.message}`);
    }
    const fallback = await readFallbackGames(seen);
    results.push(...fallback);
    results.sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
    });
    return results;
}

async function loadGameMeta(slug) {
    const dir = path.join(publicGamesDir, slug);
    if (!hasPlan(dir)) return null;
    const metaPath = path.join(dir, 'meta.json');
    const meta = await readJSONIfExists(metaPath);
    const createdAt = meta?.createdAt || null;
    const updatedAt = meta?.updatedAt || createdAt || null;
    const cover = selectCoverPath(slug, dir, meta?.cover);
    return {
        slug,
        name: meta?.name || slug,
        author: meta?.author || 'AI Runtime',
        cover,
        brief: meta?.brief || '',
        createdAt,
        updatedAt,
    };
}

async function readFallbackGames(seen) {
    const list = [];
    const fallbackPath = path.join(repoRoot, 'packages/webgal/public', 'games.json');
    try {
        const raw = await fsp.readFile(fallbackPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            for (const entry of parsed) {
                if (!entry || typeof entry !== 'object') continue;
                const slug = entry.slug;
                if (!slug || seen.has(slug)) continue;
                list.push({
                    slug,
                    name: entry.name || slug,
                    author: entry.author || 'Unknown',
                    cover: entry.cover || `games/${slug}/background/cover.png`,
                    brief: entry.brief || '',
                    createdAt: null,
                    updatedAt: null,
                });
                seen.add(slug);
            }
        }
    } catch (err) {
        logger.warn(`[games] failed to read games.json fallback: ${err.message}`);
    }
    return list;
}

function sanitizeSlug(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function createUniqueSlug(seed) {
    const base = sanitizeSlug(seed) || 'story';
    let candidate = `${base}-${generateSlugSuffix()}`;
    let attempt = 0;
    while (fs.existsSync(path.join(publicGamesDir, candidate)) && attempt < 1000) {
        candidate = `${base}-${generateSlugSuffix()}`;
        attempt += 1;
    }
    return candidate;
}

function generateSlugSuffix() {
    const raw = typeof randomUUID === 'function' ? randomUUID() : Math.random().toString(36).slice(2);
    return raw.replace(/-/g, '').slice(0, 8);
}

function readCookieValue(req, name) {
    const cookieHeader = req.headers?.cookie;
    if (!cookieHeader) return null;
    const parts = cookieHeader.split(';').map((part) => part.trim());
    for (const part of parts) {
        const [key, value] = part.split('=');
        if (key === name) {
            return value;
        }
    }
    return null;
}

function sanitizeSessionId(value) {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim().replace(/[^A-Za-z0-9_-]/g, '');
    if (!trimmed) return null;
    return trimmed.slice(0, 64);
}

function generateSessionIdValue() {
    return sanitizeSessionId(
        typeof randomUUID === 'function' ? randomUUID() : Math.random().toString(36).slice(2),
    ) || `${DEFAULT_SESSION}-${Date.now().toString(36)}`;
}

function ensureSessionId(req, res) {
    const headerKey = SESSION_HEADER.toLowerCase();
    const incomingHeader = req.headers[headerKey];
    const headerValue = Array.isArray(incomingHeader) ? incomingHeader[0] : incomingHeader;
    let sessionId = sanitizeSessionId(headerValue);
    if (!sessionId) {
        sessionId = sanitizeSessionId(readCookieValue(req, SESSION_COOKIE));
    }
    if (!sessionId) {
        sessionId = generateSessionIdValue();
        res.append('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
    }
    return sessionId;
}
