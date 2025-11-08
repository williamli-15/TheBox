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

- Copy `packages/server/runtimeSceneProvider.js` somewhere else, implement your own `getRuntimeSlice(gameSlug, sliceId)` and export it via `module.exports`.
- Start the dev server with `WEBGAL_RUNTIME_PROVIDER=relative/path/to/custom-provider.js yarn workspace WebGAL-Server start`.
- The provider receives:
  - `gameSlug`: folder name under `public/games`.
  - `sliceId`: string such as `ai-demo/entry` (without `.txt`).
- Return plain WebGAL script text. You can call an LLM here, stream files, or query your backend.

### Front-end details

- `packages/webgal/src/Core/util/prefetcher/scenePrefetcher.ts` skips any scene containing `/runtime/` to avoid prefetch errors.
- The sample game (`games/story-lab`) adds a third option in `scene/start.txt` that calls `runtime/ai-demo/entry.txt`, which hits the demo provider so you can see the flow end-to-end.

Once your generator is ready, simply emit more slices via `changeScene: runtime/...;` or branch with `choose:` entries that point to other runtime slices. The engine still handles saves/loads as usual because the runtime slices live in the same scene pipeline.
