import { expect, test } from "vitest";
import { GROUNDS, MAX_OBJECTIONS, RUBRIC, START_HP, rubricText, turnOrder } from "@/lib/engine/rubric";

test("rubric points", () => {
  expect(Object.fromEntries(Object.entries(RUBRIC).map(([k, v]) => [k, v.points]))).toEqual({
    UNSUPPORTED: 1, REPETITION: 1, EVASION: 1, FALLACY: 2, CONTRADICTION: 3, SUSTAINED: 1,
  });
});

test("constants", () => {
  expect(START_HP).toBe(10);
  expect(MAX_OBJECTIONS).toBe(2);
});

test("every code has both anchoring examples", () => {
  for (const r of Object.values(RUBRIC)) {
    expect(r.counts.length).toBeGreaterThan(10);
    expect(r.doesNot.length).toBeGreaterThan(10);
  }
});

test("objection grounds", () => {
  expect(Object.keys(GROUNDS).sort()).toEqual([
    "ASKED_AND_ANSWERED", "ASSUMES_FACTS", "MISCHARACTERIZATION", "RELEVANCE", "SPECULATION",
  ]);
});

test("turn order respects first speaker", () => {
  const o = turnOrder("NEMESIS");
  expect(o).toHaveLength(10);
  expect(o.map((t) => t.lawyer)).toEqual(Array.from({ length: 10 }, (_, i) => (i % 2 ? "AEGIS" : "NEMESIS")));
  expect(o.map((t) => t.phase)).toEqual(["opening", "opening", ...Array(6).fill("rebuttal"), "closing", "closing"]);
  expect(turnOrder("AEGIS")[0]).toEqual({ lawyer: "AEGIS", phase: "opening" });
});

test("rubricText lists every code and its examples", () => {
  const t = rubricText();
  for (const [code, r] of Object.entries(RUBRIC)) {
    expect(t).toContain(code);
    expect(t).toContain(r.counts);
  }
});
