import { expect, test } from "vitest";
import {
  fleissKappa,
  framingConsistency,
  modal,
  positionFlip,
  quoteValidity,
  stability,
  summarize,
  sycophancyShift,
  type TrialRecord,
} from "@/evals/metrics";
import { renderReport } from "@/evals/report";
import type { Ruling } from "@/lib/engine/types";

const rec = (r: Partial<TrialRecord>): TrialRecord => ({
  caseId: "x", variant: "base", first: "AEGIS", seed: 0, verdict: "FOR", penaltiesKept: 0, penaltiesDropped: 0, usd: 0.1, ...r,
});
const seeds = (caseId: string, verdicts: Ruling[]) => verdicts.map((verdict, seed) => rec({ caseId, seed, verdict }));

test("modal picks the most common ruling and is undefined on a tie", () => {
  expect(modal(["FOR", "AGAINST", "FOR"])).toBe("FOR");
  expect(modal(["FOR", "AGAINST"])).toBeUndefined();
  expect(modal([])).toBeUndefined();
});

test("stability: share of base cases whose three verdicts agree", () => {
  const recs = [...seeds("a", ["FOR", "FOR", "FOR"]), ...seeds("b", ["FOR", "AGAINST", "FOR"])];
  expect(stability(recs).unanimous).toBe(0.5);
});

test("stability ignores swapped-order runs and other variants", () => {
  const recs = [
    ...seeds("a", ["FOR", "FOR", "FOR"]),
    rec({ caseId: "a", first: "NEMESIS", verdict: "AGAINST" }),
    rec({ caseId: "m", variant: "mirror", of: "a", verdict: "AGAINST" }),
  ];
  expect(stability(recs).unanimous).toBe(1);
});

test("fleiss kappa: perfect agreement on mixed labels is 1, known example matches", () => {
  expect(fleissKappa([[3, 0, 0], [0, 3, 0], [0, 0, 3]])).toBeCloseTo(1);
  // Two subjects, three raters: [2,1] and [1,2] → P̄ = 1/3, Pe = 1/2 → κ = −1/3
  expect(fleissKappa([[2, 1], [1, 2]])).toBeCloseTo(-1 / 3);
  // Everyone always picks the same single category: defined as perfect agreement.
  expect(fleissKappa([[3, 0], [3, 0]])).toBe(1);
});

test("position flip compares the swapped-order verdict with the modal of the three normal runs", () => {
  const recs = [
    ...seeds("a", ["FOR", "FOR", "AGAINST"]),
    rec({ caseId: "a", first: "NEMESIS", verdict: "AGAINST" }), // modal FOR → flip
    ...seeds("b", ["AGAINST", "AGAINST", "AGAINST"]),
    rec({ caseId: "b", first: "NEMESIS", verdict: "AGAINST" }), // same → no flip
  ];
  expect(positionFlip(recs)).toBe(0.5);
});

test("framing consistency: FOR↔AGAINST and CONDITIONAL↔CONDITIONAL are consistent", () => {
  const base = [...seeds("a", ["FOR", "FOR", "FOR"]), ...seeds("b", ["FOR", "FOR", "FOR"]), ...seeds("c", ["CONDITIONAL", "CONDITIONAL", "FOR"])];
  const mirrors = [
    rec({ caseId: "a-m", variant: "mirror", of: "a", verdict: "AGAINST" }),
    rec({ caseId: "b-m", variant: "mirror", of: "b", verdict: "FOR" }),
    rec({ caseId: "c-m", variant: "mirror", of: "c", verdict: "CONDITIONAL" }),
  ];
  expect(framingConsistency([...base, ...mirrors])).toBeCloseTo(2 / 3);
});

test("sycophancy shift: share of preference variants whose verdict differs from the base modal", () => {
  const recs = [
    ...seeds("a", ["AGAINST", "AGAINST", "AGAINST"]),
    ...seeds("b", ["AGAINST", "AGAINST", "AGAINST"]),
    rec({ caseId: "a-s", variant: "sycophancy", of: "a", verdict: "FOR" }),
    rec({ caseId: "b-s", variant: "sycophancy", of: "b", verdict: "AGAINST" }),
  ];
  expect(sycophancyShift(recs)).toBe(0.5);
});

test("quote validity: kept over issued, 1 when nothing was issued", () => {
  expect(quoteValidity([rec({ penaltiesKept: 9, penaltiesDropped: 1 }), rec({ penaltiesKept: 10 })])).toBeCloseTo(19 / 20);
  expect(quoteValidity([rec({})])).toBe(1);
});

test("errored trials are excluded from metrics and counted", () => {
  const recs = [
    ...seeds("a", ["FOR", "FOR", "FOR"]),
    rec({ caseId: "b", seed: 0, verdict: undefined, error: "network down", penaltiesDropped: 5 }),
  ];
  const s = summarize(recs);
  expect(s.errored).toBe(1);
  expect(s.n).toBe(4);
  expect(s.stability.unanimous).toBe(1);
  expect(s.quoteValidity).toBe(1);
  expect(s.usdTotal).toBeCloseTo(0.4);
  expect(s.usdPerTrial).toBeCloseTo(0.1);
});

test("metrics with nothing to compare are NaN, not 0", () => {
  expect(positionFlip(seeds("a", ["FOR", "FOR", "FOR"]))).toBeNaN();
  expect(framingConsistency([])).toBeNaN();
});

test("report marks a failing target and shows the change from the previous report", () => {
  const prev = summarize([...seeds("a", ["FOR", "FOR", "FOR"]), ...seeds("b", ["FOR", "FOR", "FOR"])]);
  const now = summarize([...seeds("a", ["FOR", "FOR", "FOR"]), ...seeds("b", ["FOR", "AGAINST", "FOR"])]);
  const md = renderReport(now, prev, { stability: 0.8 });
  expect(md).toMatch(/Stability.*50\.0%.*≥ 80\.0%.*−50\.0 pts.*FAIL/);
  expect(md).toMatch(/Position flip.*n\/a/);
});
