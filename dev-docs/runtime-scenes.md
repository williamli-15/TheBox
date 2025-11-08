## Runtime Scene Slices

Plan B from the AI-runtime discussion is now wired into the dev server. When a script jumps to `runtime/...` (for example `changeScene:runtime/ai-demo/entry.txt;`) the asset loader issues a request to `/games/<slug>/scene/runtime/ai-demo/entry.txt`.

### How it works

1. `packages/server/index.js` intercepts every `/games/:slug/scene/runtime/*.txt` request before the static middleware.
2. The request is passed to `packages/server/runtimeSceneProvider.js`.
3. `runtimeSceneProvider` either:
   - Delegates to a custom provider exported from the file pointed to `WEBGAL_RUNTIME_PROVIDER`, or
   - Falls back to the built-in demo slices that showcase a simple choose → branch → end flow.
4. The returned text is served as a regular WebGAL script, so the engine can keep parsing without any extra changes.

### Customising the provider

- 直接使用示例 LLM 提供器：`packages/server/llmProvider.js`（依赖 `OPENAI_API_KEY`，可通过 `OPENAI_MODEL` 覆盖模型名称）。
  启动方式：
  ```bash
  cd packages/server
  OPENAI_API_KEY=sk-xxx WEBGAL_RUNTIME_PROVIDER=./llmProvider.js node index.js ../webgal
  ```
- 每次调用都会把 **输入提示（system/user）** 和 **输出脚本** 写到 `packages/server/logs/runtime-YYYYMMDD.log`（默认每次启动都会自动清空当日的日志；如需累计追加可设置 `WEBGAL_RUNTIME_LOG_APPEND=true`）。控制台只展示一条裁剪后的 preview（默认 200 字）。可用 `WEBGAL_RUNTIME_LOG_DIR`、`WEBGAL_RUNTIME_LOG_PREVIEW` 调整目录与截断长度。
- 或者复制 `packages/server/runtimeSceneProvider.js` 到其他位置，实现自定义的 `getRuntimeSlice(gameSlug, sliceId)` 并 `module.exports`。
- 启动 server 时用 `WEBGAL_RUNTIME_PROVIDER=relative/path/to/custom-provider.js yarn workspace WebGAL-Server start` 指向它。
- provider 会收到：
  - `gameSlug`: `public/games` 下的目录名。
  - `sliceId`: 例如 `ai-demo/entry`（即 `runtime/*.txt` 的路径去掉 `.txt`）。
- 返回值必须是纯 WebGAL 脚本文本。这里面可以调用任意 LLM、RAG、后端接口等。

### Front-end details

- `packages/webgal/src/Core/util/prefetcher/scenePrefetcher.ts` skips any scene containing `/runtime/` to avoid prefetch errors.
- The sample game (`games/story-lab`) adds a third option in `scene/start.txt` that calls `runtime/ai-demo/entry.txt`, which hits the demo provider so you can see the flow end-to-end.

Once your generator is ready, simply emit more slices via `changeScene: runtime/...;` or branch with `choose:` entries that point to other runtime slices. The engine still handles saves/loads as usual because the runtime slices live in the same scene pipeline.
