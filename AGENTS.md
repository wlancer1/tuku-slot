# Repository Guidelines

## Project Structure & Module Organization
- Root JavaScript files power the extension: `background.js` (service worker), `contentScript.js` (page automation), `popup.js` and `options.js` (UI logic).
- Static assets live alongside their owners (`popup.html`/`popup.css`, `options.html`/`options.css`, `icons/`).
- Configuration is driven by `manifest.json`; update permissions and entry points there before adding new features.
- Keep exploratory snippets in `cankao.md` or `need.md` and avoid shipping experimental code in production modules.

## Build, Test, and Development Commands
- There is no bundler pipeline; load the folder directly via `chrome://extensions` → **Load unpacked**.
- For rapid iteration use Chrome’s “Service Worker” inspector to reload `background.js` and the DevTools “Sources” panel to hot-reload content scripts (`chrome.runtime.reload()` in the console works well).
- To lint or format, run `npx prettier --check "*.js"` (add `--write` before committing if you adjust formatting).

## Coding Style & Naming Conventions
- Use 2-space indentation, trailing commas where valid, and single quotes for strings to match existing files.
- Prefer descriptive camelCase identifiers (`loginTriggerButton`, `collectTmallListWithDetails`) and keep module-level constants in SCREAMING_SNAKE_CASE.
- When adding helpers, colocate them near their usage and document non-obvious logic with concise comments.

## Testing Guidelines
- No automated test harness exists; verify features manually:
  1. Load the extension in a Chromium browser.
  2. Exercise affected flows on supported storefronts (Temu, Tmall, Taobao, 1688).
  3. Watch the console for `LOG_PREFIX` output and ensure network calls succeed.
- When fixing bugs, add a reproducible scenario to `README.md` or the issue tracker to preserve context.

## Commit & Pull Request Guidelines
- Write imperative, scoped commit messages (e.g., `Add Tmall inline automation fallback`); squash local debug commits before sharing.
- Each pull request should describe the change, impact on supported sites, manual verification steps, and any required configuration updates.
- Attach screenshots or console snippets when altering popup/options UI, and reference related issues or tickets for traceability.
