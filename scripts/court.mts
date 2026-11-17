// Plays a trial one step at a time. Each step is answered by you or your coding agent (see .claude/skills/courtroom/SKILL.md),
// so no API key is needed. The engine scores every step exactly as in `npm run trial`.
// Usage:
//   npm run court -- start "<idea>" [--context "<text>"] [--first AEGIS|NEMESIS]
//   npm run court -- next                         show the request waiting for an answer
//   npm run court -- answer --file reply.json     (or pass the JSON as an argument, or pipe it on stdin)
// Option: --session <path>   (default trials-out/court-session.json)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs, styleText } from "node:util";
import { CaseError, validateCase } from "../lib/engine/case";
import { START_HP } from "../lib/engine/rubric";
import type { Lawyer, TrialEvent } from "../lib/engine/types";
import { advance, newSession, recordAnswer, renderRequest, type Session } from "../lib/node/court-session";
import { renderEvent } from "./trial.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    context: { type: "string" },
    first: { type: "string" },
    file: { type: "string" },
    session: { type: "string", default: "trials-out/court-session.json" },
  },
});
const [command, ...rest] = positionals;
const sessionPath = values.session!;
const w = (s: string) => process.stdout.write(s);

const save = (s: Session) => {
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, JSON.stringify(s, null, 2) + "\n");
};
const load = (): Session => {
  if (!existsSync(sessionPath)) throw new CaseError(`No trial in progress. Start one: npm run court -- start "<idea>"`);
  return JSON.parse(readFileSync(sessionPath, "utf8"));
};

/** Prints the events after `shown`, then the next request or the end of the trial. */
async function report(s: Session, shown: number) {
  const { events, pending } = await advance(s);
  const hp: Record<Lawyer, number> = { AEGIS: START_HP, NEMESIS: START_HP };
  events.forEach((e: TrialEvent, i) => renderEvent(e, hp, i < shown ? () => {} : w));
  if (pending) {
    w(`\n${styleText("dim", `--- step ${s.answers.length + 1}: answer with npm run court -- answer --file <reply.json> ---`)}\n${renderRequest(pending)}\n`);
    return;
  }
  const out = `trials-out/court-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify(events, null, 2) + "\n");
  w(`\n${styleText("dim", `Trial complete · saved ${out}`)}\n`);
}

async function readAnswer(): Promise<unknown> {
  let text = values.file ? readFileSync(values.file, "utf8") : rest.join(" ");
  if (!text.trim()) {
    if (process.stdin.isTTY) throw new CaseError("Pass the answer JSON: --file reply.json, as an argument, or on stdin.");
    for await (const chunk of process.stdin) text += chunk;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CaseError("The answer is not valid JSON.");
  }
}

try {
  if (command === "start") {
    const c = validateCase({ idea: rest.join(" "), context: values.context });
    if (values.first && values.first !== "AEGIS" && values.first !== "NEMESIS") throw new CaseError("--first must be AEGIS or NEMESIS.");
    const s = newSession(c, (values.first as Lawyer | undefined) ?? (Math.random() < 0.5 ? "AEGIS" : "NEMESIS"));
    save(s);
    await report(s, 0);
  } else if (command === "next") {
    await report(load(), 0);
  } else if (command === "answer") {
    const s = load();
    const before = await advance(s);
    if (!before.pending) throw new CaseError("This trial is already complete.");
    const next = recordAnswer(s, before.pending, await readAnswer());
    save(next);
    await report(next, before.events.length);
  } else {
    throw new CaseError('Commands: start "<idea>" | next | answer --file reply.json');
  }
} catch (e) {
  if (!(e instanceof CaseError) && !(e instanceof Error && e.message.startsWith("Invalid "))) throw e;
  console.error(e.message);
  process.exit(1);
}
