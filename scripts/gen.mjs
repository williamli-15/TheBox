// 文件: scripts/gen.mjs  （放在仓库根目录）
// Node 18+ 可直接运行：node scripts/gen.mjs
import fs from 'fs/promises';
import path from 'path';

const GAME_SLUG = process.env.GAME_SLUG ?? 'story-lab';
const GAME_ROOT = path.resolve('packages/webgal/public/games', GAME_SLUG);

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
  ];
  for (const rel of need) {
    await fs.mkdir(path.join(GAME_ROOT, rel), { recursive: true });
  }
}

// —— 这里替换成你们自己的 LLM 调用 ——
// 返回值必须是“纯 WebGAL 脚本文本”，每行以 ; 结尾，不要夹杂说明文字。
async function callLLM(prompt) {
  // 示例1：本地假数据（默认）
  if (!process.env.LLM_ENDPOINT) {
    return `intro:一座熟悉的城市，夜色像墨|匿名委托：去旧城区找失踪工程师|;
:你站在街角，冷风灌进外套。;
choose:直接出发:chapter_01/old_town.txt|先回营地准备:camp;
;
label:camp;
:你回到营地，检查装备与弹药。;
choose:出发:chapter_01/old_town.txt|再确认一次:camp;
`;
  }

  // 示例2：有你们的生成接口时用这个（Node18+自带fetch）
  const res = await fetch(process.env.LLM_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.LLM_TOKEN ? { Authorization: `Bearer ${process.env.LLM_TOKEN}` } : {}) },
    body: JSON.stringify({
      // 你们后端期待的入参，自己改
      prompt,
      // 强烈建议让后端模板化，保证严格输出 WebGAL 语法
    }),
  });
  const text = await res.text();
  return text.trim();
}

const webgalRules = `
你要生成 WebGAL 脚本（ws），每行必须以英文分号 ';' 结束。
常用命令示例：
  旁白:  :这是旁白;
  对话:  角色名:一句话;
  选项:  choose:去商店:chapter_01/shop.txt|回家:home;
  标签:  label:home; / jumpLabel:home;
  结束:  end;
不要输出任何解释性文字或 Markdown，只输出脚本正文。
`;

// 生成 start.txt
async function genStart() {
  const prompt = `
${webgalRules}
任务：写一个 2~3 分钟的“开场场景 start.txt”。
剧情：接到委托，去旧城区寻找失踪工程师。
要求：
- 开头用 intro 黑屏，2~3 行。
- 至少 1 个 choose，允许先回营地再出发的分支，收束回主线。
- 结尾跳到 chapter_01/old_town.txt 或 end;
`;
  const txt = await callLLM(prompt);
  await fs.writeFile(path.join(GAME_ROOT, 'scene', 'start.txt'), txt, 'utf-8');
}

// 生成 chapter_01/old_town.txt
async function genOldTown() {
  const prompt = `
${webgalRules}
任务：生成 "chapter_01/old_town.txt"，承接 start.txt 的去旧城区分支。
要求：
- 出场一个关键 NPC（给出名字）。
- 至少 1 个 choose（允许 BAD END -> end;，或回主线）。
- 结尾可以 end; 或 callScene:chapter_01/factory.txt;（随意其一）。
`;
  const txt = await callLLM(prompt);
  await fs.writeFile(path.join(GAME_ROOT, 'scene', 'chapter_01', 'old_town.txt'), txt, 'utf-8');
}

(async () => {
  await ensureDirs();
  await genStart();
  await genOldTown();
  console.log(
    `✅ 生成完成：packages/webgal/public/games/${GAME_SLUG}/scene 已写入 start.txt 和 chapter_01/old_town.txt`,
  );
})();
