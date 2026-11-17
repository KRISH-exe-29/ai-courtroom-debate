# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-17

First public release: the trial engine, the terminal courtroom and the judge evaluation harness.

### Added

- Trial engine: ten turns (two openings, six rebuttals, two closings), objections, knockouts and a replayable event log.
- Rubric scoring with six penalty types; points come from the rubric, and penalties whose quotes are not in the turn are dropped.
- Blind judge with a random speaking order: the judge sees "Side A" and "Side B", never the lawyer names.
- Terminal courtroom (`npm run trial`) with streamed speeches and live HP bars.
- Providers: Claude, Gemini, any OpenAI-compatible server (Ollama, Groq, OpenRouter), and Claude Code or Codex on your own login.
- Step-by-step mode (`npm run court`) and a skill that lets a coding agent play a trial without an API key.
- Evaluation harness (`npm run eval`): 60 cases measuring stability, position flip, framing consistency, sycophancy and quote validity.
- Fallacy benchmark (`npm run eval:fallacy`) on the LOGIC and IBM ArgQ-30k datasets.

[0.1.0]: https://github.com/KRISH-exe-29/ai-courtroom-debate/releases/tag/v0.1.0
