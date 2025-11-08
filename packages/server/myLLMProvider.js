const fs = require('fs');
const path = require('path');

// 允许通过环境变量覆盖默认的运行时剧情生成器
let customProvider = null;
const providerPath = process.env.WEBGAL_RUNTIME_PROVIDER
  ? path.resolve(process.cwd(), process.env.WEBGAL_RUNTIME_PROVIDER)
  : null;

if (providerPath && fs.existsSync(providerPath)) {
  customProvider = require(providerPath);
}

const normalizeSliceId = (sliceId) => sliceId.replace(/\\/g, '/').replace(/\.txt$/, '');

const demoSlices = {
  'story-lab': {
    'ai-demo/entry': `
intro:正在请求即时生成的剧情|这一段内容由 server/runtimeSceneProvider.js 动态返回;
:你跟随匿名委托来到废弃的讯号塔。;
choose:追踪信号:runtime/ai-demo/signal.txt|先观察周围:runtime/ai-demo/camp.txt;
`,
    'ai-demo/signal': `
changeBg:bg.png -next;
:信号越来越清晰，塔顶忽然亮起蓝色脉冲。;
:你决定沿着扶梯往上，准备截获来源。;
changeScene:chapter_01/shop.txt;
`,
    'ai-demo/camp': `
:你蹲守在旧营地的阴影里，录下塔的每一次闪烁。;
choose:耐心等待:runtime/ai-demo/camp.txt|立刻驶向讯号塔:runtime/ai-demo/signal.txt|回到静态剧情:chapter_01/shop.txt;
`,
  },
};

const fallbackSlice = (gameSlug, sliceId) => `;${gameSlug}:${sliceId} 未提供运行时脚本，检查 server/runtimeSceneProvider.js;\nend;`;

async function getRuntimeSlice(gameSlug, rawSliceId) {
  const normalizedSlug = (gameSlug || 'default').toLowerCase();
  const sliceId = normalizeSliceId(rawSliceId);

  if (customProvider && typeof customProvider.getRuntimeSlice === 'function') {
    const customResult = await customProvider.getRuntimeSlice(normalizedSlug, sliceId);
    if (customResult) {
      return customResult;
    }
  }

  const storyDeck = demoSlices[normalizedSlug] || demoSlices['story-lab'] || {};
  return storyDeck[sliceId] || fallbackSlice(normalizedSlug, sliceId);
}

module.exports = {
  getRuntimeSlice,
};
