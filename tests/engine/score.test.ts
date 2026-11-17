import { expect, test } from "vitest";
import { applyRuling, clampVerdict, quoteMatches } from "@/lib/engine/score";
import { RulingInput, VerdictInput } from "@/lib/engine/schema";

const full = { AEGIS: 10, NEMESIS: 10 };

test("quote matching ignores spacing, curly quotes and case", () => {
  expect(quoteMatches("“it  WILL fail”", 'They said "it will fail" twice')).toBe(true);
  expect(quoteMatches("it’s over", "I think it's over now")).toBe(true);
  expect(quoteMatches("never said", "something else")).toBe(false);
  expect(quoteMatches("", "anything")).toBe(false);
  expect(quoteMatches('""', "anything")).toBe(false);
});

test("rubric sets points; unmatched quote is dropped and counted", () => {
  const r = applyRuling({
    hp: full, speaker: "AEGIS", turn: 0, text: "Markets always go up.", priorText: "",
    ruling: { penalties: [
      { code: "UNSUPPORTED", reason: "r", quote: "always go up" },
      { code: "FALLACY", reason: "r", quote: "not in text" },
    ] },
  });
  expect(r.hp).toEqual({ AEGIS: 9, NEMESIS: 10 });
  expect(r.penalties).toEqual([{ code: "UNSUPPORTED", points: 1, reason: "r", quote: "always go up" }]);
  expect(r.dropped).toBe(1);
  expect(r.changes).toEqual([{ type: "hp_change", lawyer: "AEGIS", delta: -1, hp: 9, reason: "r", code: "UNSUPPORTED", turn: 0 }]);
});

test("judge cannot sanction with SUSTAINED as a penalty code", () => {
  const r = applyRuling({ hp: full, speaker: "AEGIS", turn: 1, text: "abc", priorText: "",
    ruling: { penalties: [{ code: "SUSTAINED", reason: "r", quote: "abc" }] } });
  expect(r.dropped).toBe(1);
  expect(r.hp.AEGIS).toBe(10);
});

const prior = "<case>I have 2 years of savings</case>";
const base = { hp: full, speaker: "NEMESIS" as const, turn: 3, text: "You have no savings.", priorText: prior };

test("CONTRADICTION with evidence in prior text costs 3", () => {
  const r = applyRuling({ ...base, ruling: { penalties: [{ code: "CONTRADICTION", reason: "r", quote: "no savings", evidence: "2 years of savings" }] } });
  expect(r.hp.NEMESIS).toBe(7);
  expect(r.penalties[0]).toMatchObject({ points: 3, evidence: "2 years of savings" });
});

test("CONTRADICTION without matching evidence is dropped", () => {
  expect(applyRuling({ ...base, ruling: { penalties: [{ code: "CONTRADICTION", reason: "r", quote: "no savings", evidence: "made up" }] } }).dropped).toBe(1);
  expect(applyRuling({ ...base, ruling: { penalties: [{ code: "CONTRADICTION", reason: "r", quote: "no savings" }] } }).dropped).toBe(1);
});

test("sustained objection costs the objected-against lawyer 1", () => {
  const r = applyRuling({ hp: full, speaker: "AEGIS", turn: 2, text: "t", priorText: "",
    ruling: { penalties: [], objection: "SUSTAINED" }, objectionAgainst: "NEMESIS" });
  expect(r.hp).toEqual({ AEGIS: 10, NEMESIS: 9 });
  expect(r.changes[0]).toMatchObject({ lawyer: "NEMESIS", code: "SUSTAINED", delta: -1 });
});

test("overruled objection costs nothing", () => {
  const r = applyRuling({ hp: full, speaker: "AEGIS", turn: 2, text: "t", priorText: "",
    ruling: { penalties: [], objection: "OVERRULED" }, objectionAgainst: "NEMESIS" });
  expect(r.hp).toEqual(full);
  expect(r.changes).toEqual([]);
});

test("objection ruling without an objection is ignored", () => {
  const r = applyRuling({ hp: full, speaker: "AEGIS", turn: 2, text: "t", priorText: "",
    ruling: { penalties: [], objection: "SUSTAINED" } });
  expect(r.hp).toEqual(full);
});

test("hp floors at 0 and delta is the actual loss", () => {
  const r = applyRuling({ ...base, hp: { AEGIS: 10, NEMESIS: 1 },
    ruling: { penalties: [{ code: "CONTRADICTION", reason: "r", quote: "no savings", evidence: "2 years of savings" }] } });
  expect(r.hp.NEMESIS).toBe(0);
  expect(r.changes[0]).toMatchObject({ delta: -1, hp: 0 });
});

test("input is not mutated", () => {
  const hp = Object.freeze({ ...full });
  applyRuling({ hp, speaker: "AEGIS", turn: 0, text: "abc", priorText: "", ruling: { penalties: [{ code: "UNSUPPORTED", reason: "r", quote: "abc" }] } });
  expect(hp).toEqual(full);
});

test("clampVerdict clamps out-of-range numbers", () => {
  expect(clampVerdict({ ruling: "FOR", confidence: 140, summary: "s", turningPoint: 99 }, 4))
    .toEqual({ ruling: "FOR", confidence: 100, summary: "s", turningPoint: 3, conditions: [] });
  expect(clampVerdict({ ruling: "AGAINST", confidence: -5, summary: "s", turningPoint: -2, conditions: ["x"] }, 4))
    .toMatchObject({ confidence: 0, turningPoint: 0, conditions: ["x"] });
});

test("schemas reject malformed judge output", () => {
  expect(RulingInput.safeParse({ penalties: [{ code: "MADE_UP", reason: "r", quote: "q" }] }).success).toBe(false);
  expect(RulingInput.safeParse({ penalties: [] }).success).toBe(true);
  expect(VerdictInput.safeParse({ ruling: "MAYBE", confidence: 1, summary: "s", turningPoint: 0 }).success).toBe(false);
  expect(VerdictInput.safeParse({ ruling: "FOR", confidence: 1, summary: "s", turningPoint: 0 }).success).toBe(true);
});
