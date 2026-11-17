import { expect, test } from "vitest";
import { judgeSystem, judgeTranscript, lawyerSystem, lawyerTranscript, type PlayedTurn } from "@/lib/engine/prompts";
import { GROUNDS, RUBRIC } from "@/lib/engine/rubric";
import { wrapCase } from "@/lib/engine/case";

const c = { idea: "Quit my job to start a bakery", context: "I have savings." };
const turns: PlayedTurn[] = [
  { lawyer: "AEGIS", phase: "opening", text: "As AEGIS, I say go for it." },
  { lawyer: "NEMESIS", phase: "opening", text: "aegis is naive. NEMESIS is wrong? No." },
];

test("judge system lists every rubric code and objection ground", () => {
  const s = judgeSystem();
  for (const code of Object.keys(RUBRIC)) expect(s).toContain(code);
  for (const g of Object.keys(GROUNDS)) expect(s).toContain(g);
});

test("judge input never contains character names", () => {
  const all = judgeSystem() + judgeTranscript(c, turns, "AEGIS");
  expect(all).not.toMatch(/aegis|nemesis/i);
  expect(all).toContain("Side A");
  expect(all).toContain("Side B");
});

test("judge transcript says which side argues FOR", () => {
  expect(judgeTranscript(c, turns, "AEGIS")).toMatch(/Side A argues FOR/);
  const swapped: PlayedTurn[] = [{ lawyer: "NEMESIS", phase: "opening", text: "No." }];
  expect(judgeTranscript(c, swapped, "NEMESIS")).toMatch(/Side B argues FOR/);
  expect(judgeTranscript(c, swapped, "NEMESIS")).toContain("[0] Side A (opening)");
});

test("lawyer prompts carry their own name and the case", () => {
  expect(lawyerSystem("AEGIS")).toContain("AEGIS");
  expect(lawyerSystem("NEMESIS")).toContain("NEMESIS");
  expect(lawyerSystem("AEGIS")).not.toBe(lawyerSystem("NEMESIS"));
  const t = lawyerTranscript(c, turns);
  expect(t).toContain(wrapCase(c));
  expect(t).toContain("[1] NEMESIS (opening)");
});
