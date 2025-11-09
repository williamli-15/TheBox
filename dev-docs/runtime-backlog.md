## Runtime Backlog / Pending Decisions

以下事项目前 **尚未实现**，需要在正式对外运营前再评估是否必要，以及最合适的落地方式：

1. **终局硬约束 / Finales**  
   - 背景：现在的结局仍靠提示词软约束；长线运营希望「走一定片数后必收束」。  
   - 待做：在 `plan.json` 增加 `finales[]`（包含 `when` 表达式、目标 `runtime/finale/...` 节点），`runtimeSceneProvider` 中在每次生成前判定 signals 并改写 `sliceId`，强制进入对应结局。需要确定表达式 DSL、默认兜底 finale 以及 UI 提示。

2. **请求限流 / 成本护栏**  
   - 背景：目前未限制 `/api/lobby/bootstrap` 或 runtime 生成次数；如发生滥用会触发高额 API 费用。  
   - 待做：按 IP / session 加一个极轻量的滑动窗口（例如 bootstrap 每 sid 每分钟 N 次，runtime 间隔 >= 2s），同时保留超限提示文案。

3. **Cookie Secure / HTTPS 配置**  
   - 背景：`webgal_sid` 目前仅设置了 `HttpOnly; SameSite=Lax`；线上 HTTPS 环境应加 `Secure`。  
   - 待做：在 server 部署策略确定后，根据 `NODE_ENV` 或环境变量自动附加 `Secure`，并在文档中提示 “需在 HTTPS 上访问”。

4. **会话缓存清理策略**  
  - 背景：`runtimeWindow` 只依赖 `CACHE_TTL` 过期；大量会话并发可能撑大内存。  
  - 待做：为 `slug::sid` 缓存增加 LRU 或最大会话数限制（超出后以时间/活跃度优先级淘汰），并提供手动清理脚本。

5. **运行与成本观测**  
  - 背景：目前只有日志 preview；缺少 per-slice 耗时、tokens、cache 命中率等指标。  
  - 待做：在 `runtimeWindow` / `llmProvider` 打点（可写到日志或 Prometheus 端点），以便排查延迟与费用。

6. **更丰富的 Prompt 上下文**  
   - 背景：当前 prompt 仅包含 plan/recap/signals；若要进一步提升连贯性和分支差异，可以加“上一片玩家选择、当前大纲进度、近期选项列表”等结构化上下文。  
   - 待做：在 `storyState` 中记录这些字段，并在 `buildUserPrompt` 里扩展相应区块；但需要评估复杂度与收益，暂时搁置。

若未来确认这些需求，将在该文档更新实施方案与进度。
