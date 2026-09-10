# HUB update protocol

Use this sequence for every code update.

1. Read this file, run `git status --short`, and identify existing edits. Never reset, clean, or overwrite work already in the tree.
2. Before the first mutation, run `powershell -ExecutionPolicy Bypass -File tools/update-harness.ps1`. Record the verified backup path.
3. Search with `rg` and read only relevant line ranges. Batch independent reads. Reuse facts already established in the session.
4. Follow the existing data path: defaults and validation in `ext/model.js`, persistence in `js/store.js`, behavior in `js/app.js`, and presentation in `css/hub.css`. Extend existing components instead of creating parallel state.
5. Keep comments only for invariants, browser constraints, or non-obvious reasons. Do not narrate straightforward code.
6. Add focused behavior checks to `test/harness.mjs` for user-visible changes. Run syntax checks on edited JavaScript, then run `npm test` from `test/` once the implementation is stable.
7. For a shipped feature, update `manifest.json`, the cache version in `sw.js`, and one concise file in `updates/`.
8. Report the outcome, backup location, edited files, validation result, and any real limitation. Keep progress notes short and avoid repeating command output.

Do not include `test/node_modules`, generated screenshots, browser profiles, or backup folders in reviews unless the task concerns them.
