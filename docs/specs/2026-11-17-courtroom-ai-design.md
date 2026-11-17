# Courtroom AI — Design

Date: 2026-11-17 · Revision 2 (adds measured judge reliability) · Status: approved by owner

## Intent
Open-source portfolio project that demonstrates multi-agent reasoning *visibly* and *measurably*. A user files any decision or idea; two AI lawyers argue it live; an AI judge scores every move against a public rubric and rules.

Two differentiators vs. existing bull/bear/judge systems (e.g. TradingAgents):
1. **How the reasoning is shown** — 3D characters, live HP, tilting scales, objections, replay, shareable verdict card.
2. **Proof the judge is fair** — a published, reproducible eval of the judge's stability, bias and accuracy. Most LLM-judge projects publish none.

Success = people star/share it, and the README's eval numbers survive scrutiny from people who know the LLM-as-judge literature.

## Prior work this builds on
- Irving, Christiano, Amodei 2018 — *AI Safety via Debate* (debate + judge as oversight).
- Du et al. 2023 — *Improving Factuality and Reasoning in Language Models through Multiagent Debate*.
- Michael et al. 2023 — *Debate Helps Supervise Unreliable Experts*.
- Khan et al. 2024 (ICML) — *Debating with More Persuasive LLMs Leads to More Truthful Answers*.
- Zheng et al. 2023 — *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena* (position, verbosity, self-enhancement bias).
- WUDC Debating & Judging Manual — adjudication practice.
- Courtroom objection practice — fixed objection grounds.
- Jin et al. 2022 — *Logical Fallacy Detection* (LOGIC dataset); IBM ArgQ-Rank-30k (argument quality).

## Characters (original, no Marvel IP)
| Name | Role | Behaviour | Look |
|---|---|---|---|
| ARBITER | Judge | Scores each turn by rubric, rules on objections, issues verdict | Floating ring with a single eye |
| AEGIS | Defender | Strongest *honest* case for the idea; concedes real weaknesses rather than flatter | Blue-gold crystal shield orb |
| NEMESIS | Prosecutor | Attacks the strongest version (steelman) of the idea; no empty contrarianism | Swarm of red fractured shards |

README may say "inspired by the Vision vs. Ultron dynamic"; no Marvel names, images or logos anywhere.

## Goals
- Any decision type (personal, startup, technical).
- Trial streamed live; every penalty shown with a reason and the quoted text.
- Judge reliability measured and published; prompt changes gated by the eval.
- Works for visitors without an API key (demo mode); owner pays nothing to host (BYOK).

## Non-goals (v1)
- Web search / evidence retrieval (v2).
- Accounts, database, hosted share links.
- Mobile 3D parity (mobile gets the 2D courtroom).
- Multiple languages, voice.
- Fine-tuning or a non-Claude judge.

## Anti-goals (failure even if it works)
- AEGIS that just agrees with the user, or NEMESIS that just says "no".
- A verdict that follows the user's phrasing or wishes instead of the arguments (sycophancy).
- A verdict that depends on who spoke first (position bias).
- Penalties the judge can't point to in the text.
- Eval numbers that can't be reproduced by a stranger.
- Any copyrighted character art → takedown risk.

## Trial flow
1. **Filing** — idea (1–1000 chars, trimmed) + context (≤2000 chars).
2. **Coin flip** — who opens (`first`) is random per trial (seedable); recorded in the log. The other lawyer is `second`.
3. **Opening** — first, then second.
4. **Rebuttal ×3** — alternating first/second; each must address the opponent's previous turn.
5. **Closing** — first, then second.
6. **Verdict** — ARBITER.

After every lawyer turn, ARBITER issues a ruling. Total: 10 lawyer turns + 10 rulings + 1 verdict = 21 model calls.

### Blind judge
ARBITER never sees the names AEGIS/NEMESIS or their personas. Its transcript labels the first speaker **Side A** and the second **Side B**, and states which side argues FOR the idea. UI maps sides back to characters.

### Objections
A lawyer turn may end with one objection against the opponent's previous turn: `{ground, quote}`, where `ground` is one of:

| Ground | Meaning |
|---|---|
| RELEVANCE | Point doesn't bear on the case |
| SPECULATION | Asserts an unknowable outcome as certain |
| MISCHARACTERIZATION | Misstates my argument (strawman) |
| ASKED_AND_ANSWERED | Re-raises a point already answered |
| ASSUMES_FACTS | Relies on a fact not in the case or trial |

Max 2 objections per lawyer per trial; none on the first turn. ARBITER rules SUSTAINED (objected-against lawyer −1) or OVERRULED (no cost).

## Scoring rubric (each lawyer starts at 10 HP)
| Code | Offence | Penalty |
|---|---|---|
| UNSUPPORTED | Claim, including a factual claim, given with no reasoning or basis | −1 |
| REPETITION | Restates an earlier point without adding to it | −1 |
| EVASION | Ignores the opponent's previous point | −1 |
| FALLACY | Named logical fallacy or strawman | −2 |
| CONTRADICTION | Contradicts the case text, its own earlier turn, or a point both sides accepted | −3 |
| SUSTAINED | Objection against them sustained | −1 |

- `FACTUAL` from revision 1 is replaced by `CONTRADICTION`: without web search the judge cannot verify world facts, but it can verify contradictions inside the transcript. Bare factual assertions fall under UNSUPPORTED.
- Every penalty carries `{code, reason, quote}`; `quote` must match the turn. CONTRADICTION also carries `evidence`, which must match the case or an earlier turn. Unmatched penalties are dropped and counted (quote-validity metric).
- Points come from the rubric by code, never from the judge.
- Each code has 2 anchoring examples (one that counts, one that doesn't), shown in the judge prompt and on the public `/rubric` page.
- HP floors at 0. **Knockout:** HP 0 ends the trial; ARBITER still issues a verdict.

## Verdict
`{ruling: FOR | AGAINST | CONDITIONAL, conditions[], confidence 0–100, summary, turningPoint}`. HP is the score, not the ruling: the judge may rule against the HP leader but must say why. Out-of-range numbers are clamped.

## Evaluation (the credibility layer)

### Case set — `evals/cases.json`
- **40 base cases**, 8 each across: career, startup, technical, personal, absurd. Written as paraphrases of the *kinds* of decisions people post publicly (e.g. r/Advice, r/startups) — never copied text, no usernames.
- **10 mirror cases** — the negation of 10 base cases ("Should I quit?" ↔ "Should I stay?").
- **10 sycophancy cases** — 10 base cases with the user's preference added ("I really want to do this.").

### Runs per eval round
| Run | Count | Measures |
|---|---|---|
| Base, `first = AEGIS`, 3 seeds | 120 trials | Stability |
| Base, `first = NEMESIS` | 40 | Position bias |
| Mirrors | 10 | Framing consistency |
| Sycophancy | 10 | Sycophancy |
| LOGIC fallacies + top-rated ArgQ arguments | 200 judge-only calls | Fallacy precision/recall |

≈180 trials × 21 calls + 200 ≈ 4,000 calls per round. Cost is measured and reported every round.

### Metrics and initial targets
Targets are owner-adjustable starting points, revisited after the first baseline.

| Metric | Definition | Target |
|---|---|---|
| Stability | Share of base cases where all 3 verdicts agree; plus Fleiss' κ | ≥ 80% |
| Position flip | Share of base cases where the swapped-order verdict ≠ modal verdict | ≤ 15% |
| Framing consistency | Mirror verdict is the opposite (FOR↔AGAINST; CONDITIONAL↔CONDITIONAL) | ≥ 80% |
| Sycophancy shift | Sycophancy-variant verdict ≠ modal base verdict | ≤ 10% |
| Quote validity | Penalties kept / penalties issued | ≥ 95% |
| Fallacy recall | LOGIC items flagged FALLACY | ≥ 70% |
| Fallacy false positives | Top ArgQ items flagged FALLACY | ≤ 20% |
| Cost / trial | Mean USD per trial | reported |

### Outputs
`evals/results/<date>.json` (raw) and `evals/REPORT.md` (tables), committed. README links the latest report and the one-line command to reproduce it.

### Gates
- **Prompt changes:** a change to `prompts.ts` or `rubric.ts` merges only if no metric gets worse than the previous report by more than its noise margin (≥ 1 case).
- **Launch:** 3 outside human raters blind-label 20 trials (per turn: which codes apply; per trial: verdict). Report human–human agreement and judge–human agreement (Cohen's κ) in `REPORT.md`.

## Architecture

```
lib/engine/        pure TS, no React — runs in browser and Node
  types.ts         events, codes, grounds
  rubric.ts        offences, penalties, examples, objection grounds, turn order
  case.ts          validation + <case> wrapping
  score.ts         quote matching, ruling application, verdict clamping
  schema.ts        zod + tool schemas for ruling / verdict
  prompts.ts       lawyer prompts, blind judge prompt, transcripts
  trial.ts         async generator: yields TrialEvent
  reduce.ts        event log → court state
  anthropic.ts     ModelClient over the Anthropic SDK
evals/             case set, runner, metrics, fallacy bench, results, REPORT.md
scripts/trial.ts   CLI runner (records trial JSON)
app/ components/   Next.js UI (phases 2–4)
public/trials/     recorded demo trials
```

### Event log is the backbone
`runTrial` yields `filed | turn_start | speech_delta | turn_end | objection | ruling | hp_change | knockout | verdict | error`. UI, demo playback, replay and the eval runner all consume this one log.

### Model calls
- Lawyers: `claude-sonnet-5-5`, streamed; objection via a trailing tool call.
- Judge: `claude-opus-5-5`, forced tool use, zod-validated; one retry, then a skipped ruling.
- User text wrapped in `<case>` with `<` escaped; prompts state it is data, not instructions.
- Prompt caching on system prompts + rubric. Token usage reported per call for cost tracking.

### API key (BYOK)
Key in `sessionStorage`; browser calls Anthropic directly; key never touches our server. No server routes in v1. Evals and the CLI read `ANTHROPIC_API_KEY` from env.

## Visuals
- **Desktop:** R3F scene with bloom; procedural characters (geometry + shaders), no external models.
- Scale tilts by HP difference; HP bars with damage pops showing reason + quote; thought particles; OBJECTION / SUSTAINED / OVERRULED stamps with camera shake.
- `prefers-reduced-motion`: no shake/particles, static stamps.
- **Mobile / no WebGL:** 2D courtroom from the same overlay components.

## Verdict card & replay
- 1200×630 PNG generated client-side — idea, ruling, final HP, turning-point quote, characters. Download + copy.
- Trial export/import as JSON (instead of hosted share links).
- Replay scrubber over the event log with markers for penalties, objections, turning point.

## Build phases
1. **Engine + CLI + eval** — trials in terminal, eval harness, baseline report. Gate: eval targets met, or owner signs off on the gaps.
2. **2D courtroom** — streaming, HP, scale, stamps, BYOK.
3. **3D layer** — characters, particles, effects.
4. **Verdict card, replay, export/import, demo mode** (3 recorded trials).
5. **Launch** — human-rater study, README with eval numbers, repo SEO, CI, deploy, v1.0.0.

## Approaches considered
| Approach | Trade-off | Decision |
|---|---|---|
| 3D-first | Early wow, risks shallow debates | Rejected |
| Engine-first, then 2D, then 3D | Quality proven before visuals; 2D doubles as mobile | **Chosen** |
| Server-proxied API with owner's key | Smoother onboarding, owner pays and holds secrets | Rejected for BYOK + demo mode |
| Gate quality by owner reading trials | Cheap, but unmeasured and unrepeatable | Replaced by eval harness (rev 2) |
| promptfoo / Inspect AI for evals | Mature tools, but neither fits a 21-call stateful trial; Inspect is Python | Rejected for a small TS runner that reuses `runTrial` |

## Design decisions to confirm
- Objections: fixed 5 grounds, max 2 per lawyer, overruled is free.
- FACTUAL → CONTRADICTION (checkable without web search).
- Judge blind to names; Side A = first speaker. Order bias is what the swap run measures.
- Eval runs on the standard API with limited concurrency; Batches API (half price) is the upgrade if cost per round is too high — sequential turns make batching a 21-round lockstep, so it's deferred until the measured cost justifies it.
- LOGIC/ArgQ data is downloaded at eval time, not committed, unless their licenses allow redistribution.
- Metric targets are starting proposals.
- Key in `sessionStorage`, browser-direct calls, no backend.
- Procedural 3D characters.

## Left to the builder
Exact prompt wording, anchoring examples, the 40 case texts, particle/shader styling, palette, timing curves, file names below the folders listed.
