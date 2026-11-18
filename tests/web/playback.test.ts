import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { reduceEvents } from "@/lib/engine/reduce";
import type { TrialEvent } from "@/lib/engine/types";
import { playbackSteps, timelineMarkers, unblind } from "@/lib/web/playback";

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

test("rewind markers land just after each moment", () => {
  const events = load("startup");
  const markers = timelineMarkers(events);
  const count = (kind: string) => markers.filter((m) => m.kind === kind).length;
  // The startup trial: one objection, two HP losses, a turning point and the verdict.
  expect([count("objection"), count("penalty"), count("turning"), count("verdict")]).toEqual([1, 2, 1, 1]);
  expect(markers.map((m) => m.index)).toEqual([...markers.map((m) => m.index)].sort((a, b) => a - b));
  for (const m of markers) {
    const shown = reduceEvents(events.slice(0, m.index));
    if (m.kind === "verdict") expect(shown.verdict).toBeDefined();
    if (m.kind === "penalty") expect(events[m.index - 1].type).toBe("hp_change");
  }
  const atVerdict = markers.find((m) => m.kind === "verdict")!;
  expect(reduceEvents(events.slice(0, atVerdict.index - 1)).verdict).toBeUndefined();
});

test("speeches are split into several word chunks", () => {
  const steps = playbackSteps([{ type: "speech_delta", turn: 0, text: "one two three four five six seven", at: 0 }]);
  expect(steps.length).toBe(3);
  expect(steps.map((s) => (s.event as { text: string }).text).join("")).toBe("one two three four five six seven");
});
