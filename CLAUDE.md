# CLAUDE.md

Guidance for working in this repository.

## Pre-commit checklist (required)

Before **every** commit, and before pushing, run all of the following and make sure
each one passes. Do not commit or push if any step fails.

Run them in this order:

```bash
npm run fmt          # format & lint with oxfmt (writes changes)
npm run typecheck    # type-check with tsc --noEmit
npm test             # run the full test suite (vitest run)
npm run build        # emit dist/ (tsc)
```

Notes:

- **Formatter / linter.** This project uses `oxfmt` for both formatting and linting
  (`npm run fmt`). There is no separate ESLint step. Use `npm run fmt:check` if you only
  want to verify formatting without writing changes; if it reports problems, run
  `npm run fmt` and re-stage the result.
- **Tests.** `npm test` must be fully green. Coverage thresholds are enforced at 100%
  (lines, branches, functions, statements) — verify with `npm run test:coverage` when you
  change logic.
- **Build output is committed.** `dist/` is checked into the repo, so any source change
  must be followed by `npm run build`, with the regenerated `dist/` included in the commit.
  The convention is two commits: one for the source/test/docs change, then a separate
  `Build: …` commit for the `dist/` update (see `git log`).
- **Re-stage after formatting/building.** `npm run fmt` and `npm run build` can modify
  files, so run them before `git add` (or re-stage afterwards) to avoid committing stale
  output.

## Project notes

- TypeScript, ESM-only, Node.js >= 24.15.0. Uses the platform-native `fetch` /
  `AbortController` — no HTTP-client dependency.
- Source lives in `src/`, tests in `test/` (vitest), build output in `dist/`.
- The public API is `crawl(startUrl, options?)`, exported from `src/index.ts`.
