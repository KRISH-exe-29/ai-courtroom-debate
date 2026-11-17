// Runs one trial in the terminal and records its event log as JSON.
// Usage: npm run trial -- "<idea>" [--context "<text>"] [--first AEGIS|NEMESIS] [--out trials-out/<name>.json]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, styleText } from "node:util";
import { usd, type Usage } from "../lib/engine/anthropic";
import { resolveLocalProvider } from "../lib/node/agent-cli";
import { CaseError, validateCase } from "../lib/engine/case";
import type { ModelClient } from "../lib/engine/client";
import { START_HP } from "../lib/engine/rubric";
import { runTrial } from "../lib/engine/trial";
import type { Lawyer, TrialEvent } from "../lib/engine/types";

const COLOR = { AEGIS: "blue", NEMESIS: "red" } as const;
const label = (l: Lawyer) => styleText(["bold", COLOR[l]], l);
const judge = styleText(["bold", "yellow"], "ARBITER");

const bar = (hp: number) => "█".repeat(hp) + "░".repeat(START_HP - hp);

/** Prints one trial event; `hp` is updated as points change. */
export function renderEvent(e: TrialEvent, hp: Record<Lawyer, number>, w: (s: string) => void) {
  switch (e.type) {
    case "filed":
      w(`\n${styleText("bold", "CASE:")} ${e.case.idea}\n${label(e.first)} opens.\n`);
      break;
    case "turn_start":
      w(`\n${label(e.lawyer)} ${styleText("dim", `[${e.turn}] ${e.phase}`)}\n`);
      break;
    case "speech_delta":
      w(e.text);
      break;
    case "turn_end":
      w("\n");
      break;
    case "objection":
      w(`${styleText(["bold", "magenta"], "OBJECTION!")} ${e.ground} «${e.quote}»\n`);
      break;
    case "ruling":
      if (e.objection) w(`${judge} ${styleText("bold", e.objection)}\n`);
      if (e.skipped) w(`${judge} ${styleText("dim", "no ruling (invalid judge output)")}\n`);
      for (const p of e.penalties) w(`${judge} −${p.points} ${p.code}: ${p.reason}  ${styleText("dim", `«${p.quote}»`)}\n`);
      if (e.dropped) w(styleText("dim", `  (${e.dropped} penalty dropped: quote not found)\n`));
      break;
    case "hp_change":
      hp[e.lawyer] = e.hp;
      w(`  ${label("AEGIS")} ${bar(hp.AEGIS)} ${hp.AEGIS} | ${label("NEMESIS")} ${bar(hp.NEMESIS)} ${hp.NEMESIS}\n`);
      break;
    case "knockout":
      w(`\n${styleText(["bold", "red"], "KNOCKOUT:")} ${label(e.lawyer)} has no points left.\n`);
      break;
    case "verdict":
      w(`\n${judge} ${styleText("bold", `VERDICT: ${e.ruling}`)} (confidence ${e.confidence})\n${e.summary}\n`);
      for (const cond of e.conditions) w(`  - ${cond}\n`);
      w(styleText("dim", `Turning point: turn [${e.turningPoint}]\n`));
      break;
    case "error":
      w(`\n${styleText(["bold", "red"], "ERROR:")} ${e.message}\n`);
      break;
  }
}

export async function runCli(argv: string[], makeClient: (onUsage: (u: Usage) => void) => ModelClient, out = process.stdout) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { context: { type: "string" }, first: { type: "string" }, out: { type: "string" } },
  });

  const c = validateCase({ idea: positionals.join(" "), context: values.context });
  if (values.first && values.first !== "AEGIS" && values.first !== "NEMESIS") throw new CaseError("--first must be AEGIS or NEMESIS.");

  const usage: Usage[] = [];
  const client = makeClient((u) => usage.push(u));
  const events: TrialEvent[] = [];
  const hp = { AEGIS: START_HP, NEMESIS: START_HP };
  const w = (s: string) => out.write(s);

  for await (const e of runTrial(c, client, { first: values.first as Lawyer | undefined })) {
    events.push(e);
    renderEvent(e, hp, w);
  }

  const path = values.out ?? `trials-out/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(events, null, 2) + "\n");

  const total = usage.reduce((s, u) => s + usd(u), 0);
  const tokens = usage.reduce((s, u) => s + u.input + u.output + u.cacheRead + u.cacheWrite, 0);
  w(`\n${styleText("dim", `${usage.length} calls · ${tokens.toLocaleString()} tokens · ${Number.isFinite(total) ? `$${total.toFixed(4)}` : "cost n/a"} · saved ${path}`)}\n`);
  return { events, path, usd: total };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  try {
    // The client is created after the case is validated, so input errors are reported first.
    await runCli(process.argv.slice(2), (onUsage) => {
      let provider;
      try {
        provider = resolveLocalProvider(process.env);
      } catch (e) {
        throw new CaseError((e as Error).message);
      }
      console.log(styleText("dim", provider.label));
      return provider.make(onUsage);
    });
  } catch (e) {
    if (!(e instanceof CaseError)) throw e;
    console.error(e.message);
    process.exit(1);
  }
}
