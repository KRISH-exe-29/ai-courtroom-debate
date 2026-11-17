# Contributing to Courtroom AI

Thanks for helping make AI arguments fairer. This guide covers setup, the rules the code follows, and how to get a change merged.

## Setup

```bash
git clone https://github.com/KRISH-exe-29/ai-courtroom-debate.git
cd ai-courtroom-debate
npm install
npm test          # 107 tests, no network or API key needed
npx next typegen && npx tsc --noEmit  # type check
```

To run a real trial, configure a provider (see [`.env.example`](.env.example)) or have Claude Code or Codex installed, then run
`npm run trial -- "your question"`.

## Ground rules

- **The engine stays pure.** `lib/engine/` must not import React, Next.js or Node-only modules, so it can run in the browser.
  Node-only code goes in `lib/node/` or `scripts/`.
- **Tests first.** Every behaviour change comes with a test that fails without it. Use the fake client in
  `tests/fake-client.ts`; tests must never call a real model.
- **The judge stays blind.** Nothing the judge sees may contain the lawyer names or persona text. `tests/engine/trial.test.ts` checks this.
- **Prompt changes need evidence.** If you change a prompt or the rubric, run `npm run eval -- --limit 5` (or a full round)
  and include the `evals/REPORT.md` table in your pull request.

## Good first contributions

- **Evaluation cases:** add realistic cases to `evals/cases.json`, including mirror (`-m`) and opinionated (`-syc`) variants.
- **Providers:** a new `ModelClient` in `lib/engine/` (fetch-based) or `lib/node/` (process-based), with tests against a stubbed transport.
- **Prompts:** sharper lawyer personas or a clearer rubric, backed by an eval run.

## Pull requests

1. Fork, then branch from `main` (`feat/...`, `fix/...`, `docs/...`).
2. Keep the change focused; run `npm test`, `npx tsc --noEmit` and `npm run lint`.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (`feat:`, `fix:`, `docs:`...).
4. Fill in the pull request template. CI must pass before review.

## Reporting bugs and ideas

Use the [issue templates](https://github.com/KRISH-exe-29/ai-courtroom-debate/issues/new/choose). For a wrong ruling,
attach the trial JSON from `trials-out/`: it contains every event, so the trial can be replayed exactly.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
