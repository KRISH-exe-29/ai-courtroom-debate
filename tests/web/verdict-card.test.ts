import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { reduceEvents } from "@/lib/engine/reduce";
import type { TrialEvent } from "@/lib/engine/types";
import { cardData, wrapText } from "@/lib/web/verdict-card";

const measure = (s: string) => s.length; // one unit per character

test("short text stays on one line", () => {
  expect(wrapText(measure, "Should I learn Rust?", 40, 2)).toEqual(["Should I learn Rust?"]);
});

test("long text wraps at word boundaries", () => {
  expect(wrapText(measure, "one two three four five", 9, 3)).toEqual(["one two", "three", "four five"]);
});

test("text that doesn't fit ends in an ellipsis inside the width", () => {
  const lines = wrapText(measure, "alpha beta gamma delta epsilon zeta eta theta", 12, 2);
  expect(lines).toHaveLength(2);
  expect(lines[1].endsWith("…")).toBe(true);
  for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(12);
});

test("a single word wider than the line is kept rather than dropped", () => {
  expect(wrapText(measure, "supercalifragilistic", 5, 2)[0]).toBe("supercalifragilistic");
});

test("card data comes from the finished trial, with real names in the quote", () => {
  const events: TrialEvent[] = JSON.parse(readFileSync("public/trials/startup.json", "utf8"));
  const d = cardData(reduceEvents(events))!;
  expect(d.ruling).toBe("CONDITIONAL");
  expect(d.hp).toEqual({ AEGIS: 7, NEMESIS: 9 });
  expect(d.quote?.turn).toBe(6);
  expect(d.quote?.text).not.toMatch(/Side [AB]/);
});

test("no card before the verdict", () => {
  const events: TrialEvent[] = JSON.parse(readFileSync("public/trials/startup.json", "utf8"));
  expect(cardData(reduceEvents(events.slice(0, 5)))).toBeUndefined();
});
