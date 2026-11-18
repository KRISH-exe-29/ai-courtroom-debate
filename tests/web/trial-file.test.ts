import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { TrialEvent } from "@/lib/engine/types";
import { MAX_FILE_BYTES, parseTrialFile, toTrialFile, TrialFileError, trialFileName } from "@/lib/web/trial-file";

const recorded = (): TrialEvent[] => JSON.parse(readFileSync("public/trials/startup.json", "utf8"));

test("a saved trial opens back to the same events", () => {
  const events = recorded();
  expect(parseTrialFile(toTrialFile(events))).toEqual(events);
});

test("a bare event array from the terminal courtroom also opens", () => {
  expect(parseTrialFile(JSON.stringify(recorded())).length).toBe(recorded().length);
});

test.each([
  ["not JSON", "{oops", /valid JSON/],
  ["an unrelated JSON file", JSON.stringify({ name: "package" }), /isn't a saved trial/],
  ["an unknown event type", JSON.stringify([{ type: "filed", at: 0, case: { idea: "x", context: "" }, first: "AEGIS" }, { type: "explode", at: 1 }]), /isn't a saved trial/],
  ["HP outside the scale", JSON.stringify([{ type: "filed", at: 0, case: { idea: "x", context: "" }, first: "AEGIS" }, { type: "hp_change", at: 1, lawyer: "AEGIS", delta: -1, hp: 99, reason: "r", code: "UNSUPPORTED", turn: 0 }]), /isn't a saved trial/],
  ["a log that doesn't start with the case", JSON.stringify([{ type: "knockout", at: 0, lawyer: "AEGIS" }]), /doesn't start with the case/],
  ["an empty trial", JSON.stringify([]), /isn't a saved trial/],
])("rejects %s with a clear message", (_name, raw, message) => {
  expect(() => parseTrialFile(raw)).toThrow(TrialFileError);
  expect(() => parseTrialFile(raw)).toThrow(message);
});

test("rejects a file over the size limit before parsing it", () => {
  expect(() => parseTrialFile(" ".repeat(MAX_FILE_BYTES + 1))).toThrow(/too large/);
});

test("markup in a trial stays plain text", () => {
  const events = recorded();
  const filed = events[0] as Extract<TrialEvent, { type: "filed" }>;
  const crafted = [{ ...filed, case: { idea: '<img src=x onerror="alert(1)">', context: "" } }, ...events.slice(1)];
  const [first] = parseTrialFile(toTrialFile(crafted as TrialEvent[]));
  expect(first.type === "filed" && first.case.idea).toBe('<img src=x onerror="alert(1)">');
});

test("file names come from the idea", () => {
  expect(trialFileName("Should I quit my job?")).toBe("courtroom-trial-should-i-quit-my-job.json");
  expect(trialFileName("???")).toBe("courtroom-trial-trial.json");
});
