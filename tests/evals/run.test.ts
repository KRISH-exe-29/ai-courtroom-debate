import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadCases } from "@/evals/cases";
import { buildReport, planJobs, runEval, toRecord } from "@/evals/runner";
import { summarize } from "@/evals/metrics";
import { fakeClient } from "../fake-client";

const cases = loadCases();

test("full run plan has 180 trials in the spec's mix", () => {
  const jobs = planJobs(cases);
  expect(jobs).toHaveLength(180);
  expect(jobs.filter((j) => j.case.variant === "base" && j.first === "AEGIS")).toHaveLength(120);
  expect(jobs.filter((j) => j.first === "NEMESIS")).toHaveLength(40);
  expect(jobs.filter((j) => j.case.variant === "mirror")).toHaveLength(10);
  expect(jobs.filter((j) => j.case.variant === "sycophancy")).toHaveLength(10);
});

test("limit keeps the first N base cases and only their variants", () => {
  const jobs = planJobs(cases, 1); // career-1 has a mirror, no sycophancy variant
  expect(jobs.map((j) => `${j.case.id}/${j.first}/${j.seed}`)).toEqual([
    "career-1/AEGIS/0", "career-1/AEGIS/1", "career-1/AEGIS/2", "career-1/NEMESIS/0", "career-1-mirror/AEGIS/0",
  ]);
});

test("runEval turns each trial into a record with cost, penalties and errors", async () => {
  const jobs = planJobs(cases, 1);
  let calls = 0;
  const results = await runEval(jobs, (onUsage) => {
    onUsage({ model: "claude-opus-5-5", input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }); // $4
    return calls++ === 1 ? fakeClient({ throwAtTurn: 0 }) : fakeClient();
  }, { concurrency: 2 });
  expect(results).toHaveLength(5);
  expect(results[0].record).toMatchObject({ caseId: "career-1", verdict: "FOR", penaltiesKept: 0, usd: 4 });
  expect(results.filter((r) => r.record.error)).toHaveLength(1);
  expect(results[4].record).toMatchObject({ variant: "mirror", of: "career-1" });
});

test("toRecord counts kept and dropped penalties", () => {
  const job = planJobs(cases, 1)[0];
  const r = toRecord(job, [
    { at: 0, type: "ruling", turn: 0, penalties: [{ code: "UNSUPPORTED", points: 1, reason: "r", quote: "q" }], dropped: 2 },
    { at: 1, type: "verdict", ruling: "AGAINST", conditions: [], confidence: 50, summary: "s", turningPoint: 0 },
  ], 0.5);
  expect(r).toMatchObject({ penaltiesKept: 1, penaltiesDropped: 2, verdict: "AGAINST", usd: 0.5 });
  expect(r.error).toBeUndefined();
});

test("report names the models that produced the round and shows unknown cost as n/a", () => {
  const dir = mkdtempSync(join(tmpdir(), "report-"));
  const summary = { ...summarize([]), usdTotal: NaN };
  writeFileSync(join(dir, "2026-01-01.json"), JSON.stringify({ summary, models: "lawyers g · judge g" }));
  const md = buildReport(dir, {});
  expect(md).toContain("Models: lawyers g · judge g");
  expect(md).toContain("total cost n/a");
});
