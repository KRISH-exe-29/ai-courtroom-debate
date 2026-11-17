---
name: courtroom
description: Put an idea or decision on trial in Courtroom AI without an API key. You play the two lawyers (AEGIS defends, NEMESIS prosecutes) and the judge, one step at a time, while the engine scores every move. Use when the user asks to "put X on trial", "argue both sides of X", or run a courtroom trial here.
---

# Courtroom: play a trial step by step

The `court` command runs the real trial engine. It prints one request at a time (a lawyer's turn or a judge
ruling); you answer it with JSON; the engine checks quotes, applies penalties, tracks points and prints the
result. Run every command from the repository root.

## Loop

1. Start: `npm run court -- start "<the user's idea>" --context "<optional background>"`
2. Read the request it prints. It has a role, a SYSTEM section, a PROMPT section and the JSON shape to reply with.
3. Write your reply as JSON to `trials-out/reply.json`, then run `npm run court -- answer --file trials-out/reply.json`.
4. Repeat until it prints `Trial complete`. If it rejects an answer, it says why: fix the JSON and answer again.
5. Show the user the verdict and the final points. `npm run court -- next` reprints the current request at any time.

## Playing the roles

- **Lawyers:** follow the SYSTEM section exactly: argue only your side, stay under its word limit, and argue from
  the case and the transcript. Object only when the opponent's last turn really gives grounds; otherwise use
  ground `"NONE"`.
- **Judge:** the judge must be independent of the lawyers you just played. If you can start a fresh sub-agent with
  no conversation history, give it only the printed judge request and use its JSON as the answer. If you cannot,
  rule only on the printed text: forget which side you argued, quote the transcript exactly, and penalise both
  sides by the same rubric.

Never edit `trials-out/court-session.json` by hand, and do not skip steps.
