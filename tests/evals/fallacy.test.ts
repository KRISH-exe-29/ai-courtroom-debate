import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { fallacyScores, isFlagged, parseCsv, sampleItems } from "@/evals/fallacy-data";
import { buildReport } from "@/evals/runner";
import { summarize } from "@/evals/metrics";

test("fallacyScores: recall over fallacies, false-positive rate over clean items", () => {
  expect(
    fallacyScores([
      { label: "fallacy", flagged: true },
      { label: "fallacy", flagged: false },
      { label: "clean", flagged: true },
      { label: "clean", flagged: false },
    ]),
  ).toEqual({ recall: 0.5, falsePositiveRate: 0.5 });
  expect(fallacyScores([]).recall).toBeNaN();
});

test("parseCsv handles quotes, escaped quotes, commas and newlines inside fields", () => {
  const rows = parseCsv('a,b\n1,"x, ""y""\nz"\n2,plain\r\n');
  expect(rows).toEqual([
    { a: "1", b: 'x, "y"\nz' },
    { a: "2", b: "plain" },
  ]);
});

test("sampleItems is deterministic, takes top-quality clean arguments and labels both sets", () => {
  const logic = Array.from({ length: 50 }, (_, i) => ({ source_article: `fallacy ${i}`, updated_label: "ad hominem" }));
  const argq = Array.from({ length: 50 }, (_, i) => ({ argument: `arg ${i}`, topic: "t", WA: String(i / 50) }));
  const a = sampleItems(logic, argq, 10, 7);
  expect(a).toEqual(sampleItems(logic, argq, 10, 7));
  expect(a).not.toEqual(sampleItems(logic, argq, 10, 8));
  expect(a.filter((x) => x.label === "fallacy")).toHaveLength(10);
  expect(a.filter((x) => x.label === "clean").map((x) => x.text)).toEqual(
    Array.from({ length: 10 }, (_, i) => `arg ${49 - i}`),
  );
});

test("sampleItems skips blank rows", () => {
  const items = sampleItems([{ source_article: " ", updated_label: "x" }], [{ argument: "", topic: "t", WA: "1" }], 5, 1);
  expect(items).toEqual([]);
});

test("isFlagged counts only FALLACY penalties whose quote is in the text", () => {
  const text = "Everyone who disagrees is an idiot.";
  expect(isFlagged(text, { penalties: [{ code: "FALLACY", reason: "r", quote: "is an idiot" }] })).toBe(true);
  expect(isFlagged(text, { penalties: [{ code: "FALLACY", reason: "r", quote: "not there" }] })).toBe(false);
  expect(isFlagged(text, { penalties: [{ code: "UNSUPPORTED", reason: "r", quote: "is an idiot" }] })).toBe(false);
});

test("buildReport combines the latest trial round, the previous one and the latest fallacy scores", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-"));
  mkdirSync(join(dir, "fallacy"));
  const rec = { caseId: "a", variant: "base", first: "AEGIS", penaltiesKept: 0, penaltiesDropped: 0, usd: 0.1 } as const;
  const s1 = summarize([0, 1, 2].map((seed) => ({ ...rec, seed, verdict: "FOR" as const })));
  const s2 = summarize([0, 1, 2].map((seed) => ({ ...rec, seed, verdict: seed ? ("FOR" as const) : ("AGAINST" as const) })));
  writeFileSync(join(dir, "2026-01-01.json"), JSON.stringify({ summary: s1 }));
  writeFileSync(join(dir, "2026-01-02.json"), JSON.stringify({ summary: s2 }));
  writeFileSync(join(dir, "fallacy", "2026-01-03.json"), JSON.stringify({ scores: { recall: 0.9, falsePositiveRate: 0.05 } }));
  const md = buildReport(dir, { stability: 0.8, fallacyRecall: 0.7 });
  expect(md).toMatch(/Stability.*0\.0%.*−100\.0 pts.*FAIL/);
  expect(md).toMatch(/Fallacy recall.*90\.0%.*PASS/);
});

test("judgeItem survives client errors and invalid output, marking the item invalid", async () => {
  const { judgeItem } = await import("@/evals/fallacy-data");
  const item = { label: "fallacy" as const, text: "You are wrong because you are stupid.", source: "t" };
  const throwing = { streamLawyer: async function* () {}, callJudge: async () => { throw new Error("429"); } };
  await expect(judgeItem(throwing, item)).resolves.toMatchObject({ flagged: false, invalid: true });
  const junk = { streamLawyer: async function* () {}, callJudge: async () => "junk" };
  await expect(judgeItem(junk, item)).resolves.toMatchObject({ invalid: true });
  const good = {
    streamLawyer: async function* () {},
    callJudge: async () => ({ penalties: [{ code: "FALLACY", reason: "ad hominem", quote: "because you are stupid" }] }),
  };
  const r = await judgeItem(good, item);
  expect(r).toMatchObject({ flagged: true });
  expect("invalid" in r).toBe(false);
});
