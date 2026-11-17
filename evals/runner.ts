import { existsSync, readdirSync, readFileSync } from "node:fs";
import { usd, type Usage } from "../lib/engine/anthropic";
import type { ModelClient } from "../lib/engine/client";
import { runTrial } from "../lib/engine/trial";
import type { EventOf, Lawyer, TrialEvent } from "../lib/engine/types";
import type { EvalCase } from "./cases";
import { SEEDS, summarize, type Summary, type TrialRecord } from "./metrics";
import { renderReport, type Targets } from "./report";

export type Job = { case: EvalCase; first: Lawyer; seed: number };

/** The run plan: base ×3 (AEGIS first), base ×1 (NEMESIS first), each mirror and sycophancy variant ×1. */
export function planJobs(cases: EvalCase[], limit?: number): Job[] {
  const base = cases.filter((c) => c.variant === "base").slice(0, limit);
  const kept = new Set(base.map((c) => c.id));
  const variants = cases.filter((c) => c.variant !== "base" && kept.has(c.of!));
  return [
    ...base.flatMap((c) => Array.from({ length: SEEDS }, (_, seed) => seed).map((seed) => ({ case: c, first: "AEGIS" as const, seed }))),
    ...base.map((c) => ({ case: c, first: "NEMESIS" as const, seed: 0 })),
    ...variants.map((c) => ({ case: c, first: "AEGIS" as const, seed: 0 })),
  ];
}

export function toRecord(job: Job, events: TrialEvent[], cost: number): TrialRecord {
  const rulings = events.filter((e) => e.type === "ruling") as EventOf<"ruling">[];
  const verdict = events.find((e) => e.type === "verdict") as EventOf<"verdict"> | undefined;
  const error = events.find((e) => e.type === "error") as EventOf<"error"> | undefined;
  return {
    caseId: job.case.id,
    variant: job.case.variant,
    ...(job.case.of ? { of: job.case.of } : {}),
    first: job.first,
    seed: job.seed,
    ...(verdict ? { verdict: verdict.ruling } : {}),
    penaltiesKept: rulings.reduce((s, r) => s + r.penalties.length, 0),
    penaltiesDropped: rulings.reduce((s, r) => s + r.dropped, 0),
    usd: cost,
    ...(error ? { error: error.message } : {}),
  };
}

export async function runEval(
  jobs: Job[],
  makeClient: (onUsage: (u: Usage) => void) => ModelClient,
  opts: { concurrency?: number; onDone?: (done: number, total: number, r: TrialRecord) => void } = {},
) {
  // NOTE: plain API with a concurrency cap; switch to lockstep Batches API rounds if a full eval round costs too much.
  const results: { record: TrialRecord; events: TrialEvent[] }[] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i];
      let cost = 0;
      const client = makeClient((u) => (cost += usd(u)));
      const events: TrialEvent[] = [];
      for await (const e of runTrial(job.case, client, { first: job.first })) events.push(e);
      results[i] = { record: toRecord(job, events, cost), events };
      opts.onDone?.(++done, jobs.length, results[i].record);
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, jobs.length) }, worker));
  return results;
}

const latestJson = (dir: string, back = 0) => {
  if (!existsSync(dir)) return undefined;
  const name = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().at(-1 - back);
  return name ? JSON.parse(readFileSync(`${dir}/${name}`, "utf8")) : undefined;
};

/** REPORT.md from the latest trial round (with the round before it for the change column) and the latest fallacy scores. */
export function buildReport(dir = "evals/results", targets: Targets = {}): string {
  const latest: Summary = latestJson(dir)?.summary ?? summarize([]);
  const prev: Summary | undefined = latestJson(dir, 1)?.summary;
  const fallacy = latestJson(`${dir}/fallacy`)?.scores;
  return renderReport(fallacy ? { ...latest, fallacy } : latest, prev, targets);
}
