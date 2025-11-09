const fs = require('fs');
const path = require('path');

const planCache = new Map();

function loadPlan(planPath) {
  try {
    const raw = fs.readFileSync(planPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`读取剧情计划失败: ${planPath}. ${err.message}`);
  }
}

function getPlan(gameDir) {
  const normalized = path.resolve(gameDir);
  if (planCache.has(normalized)) {
    return planCache.get(normalized);
  }

  const planPath = path.join(normalized, 'story', 'plan.json');
  if (!fs.existsSync(planPath)) {
    throw new Error(`未找到剧情计划文件: ${planPath}`);
  }

  const plan = loadPlan(planPath);
  planCache.set(normalized, plan);
  return plan;
}

module.exports = {
  getPlan,
  invalidatePlan(gameDir) {
    const normalized = path.resolve(gameDir);
    planCache.delete(normalized);
  },
};
