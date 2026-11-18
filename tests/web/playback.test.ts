import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { reduceEvents } from "@/lib/engine/reduce";
import type { TrialEvent } from "@/lib/engine/types";
import { playbackSteps, unblind } from "@/lib/web/playback";

test("judge wording gets real names and turns counted from 1", () => {
  expect(unblind("Side A contradicts turn [4]; Side B agrees", "NEMESIS")).toBe("NEMESIS contradicts turn 5; AEGIS agrees");
  expect(unblind("Side A repeats", "AEGIS")).toBe("AEGIS repeats");
});

const load = (name: string): TrialEvent[] => JSON.parse(readFileSync(`public/trials/${name}.json`, "utf8"));

test.each(["startup", "rust"])("recorded trial %s plays back to the same court state", (name) => {
  const events = load(name);
  const replayed = reduceEvents(playbackSteps(events).map((s) => s.event));
  const original = reduceEvents(events);
  expect(replayed).toEqual(original);
  expect(original.verdict).toBeDefined();
  expect(original.error).toBeUndefined();
});

test("speeches are split into several word chunks", () => {
  const steps = playbackSteps([{ type: "speech_delta", turn: 0, text: "one two three four five six seven", at: 0 }]);
  expect(steps.length).toBe(3);
  expect(steps.map((s) => (s.event as { text: string }).text).join("")).toBe("one two three four five six seven");
});
