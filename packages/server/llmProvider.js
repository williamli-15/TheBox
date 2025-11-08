const OpenAI = require('openai');
const { logSlice, logRequest } = require('./runtimeLogger');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 基于 OpenAI Chat Completions 的示例运行时剧情生成器。
 * 返回值必须是“纯 WebGAL 脚本文本”，确保每行以分号结尾。
 */
async function getRuntimeSlice(gameSlug, sliceId) {
  if (!process.env.OPENAI_API_KEY) {
    return `intro:（OPENAI_API_KEY 未配置，无法生成 ${gameSlug}/${sliceId}）;`;
  }

  const systemPrompt = `你是剧情生成引擎，只能输出 WebGAL 脚本文本，不要解释。
规则：
- 每行以命令开头：intro:, say:, changeBg:, choose:, end; 等。
- 行尾必须是分号。
- 需要分支时使用 choose:选项:runtime/下一片.txt|...;`;

  const userPrompt = `当前游戏：${gameSlug}
切片：${sliceId}
请输出下一段剧情脚本。`;

  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  logRequest(gameSlug, sliceId, { model, systemPrompt, userPrompt });

  const response = await client.chat.completions.create({
    model,
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const text = response.choices?.[0]?.message?.content?.trim();
  if (text) {
    logSlice(gameSlug, sliceId, text);
  }
  return text || `intro:（生成失败，请稍后重试 ${gameSlug}/${sliceId}）;`;
}

module.exports = { getRuntimeSlice };
