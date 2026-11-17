import { expect, test } from "vitest";
import { initialState, reduceEvent, reduceEvents } from "@/lib/engine/reduce";
import { runTrial } from "@/lib/engine/trial";
import type { EventOf, TrialEvent } from "@/lib/engine/types";
import { collect, fakeClient } from "../fake-client";

const c = { idea: "Quit my job", context: "" };

async function scriptedTrial() {
  return collect(
    runTrial(
      c,
      fakeClient({
        lawyer: [[{ type: "text", text: "Always " }, { type: "text", text: "true." }], [{ type: "text", text: "No." }]],
        rulings: [{ penalties: [{ code: "UNSUPPORTED", reason: "r", quote: "always true" }] }],
      }),
      { first: "AEGIS" },
    ),
  );
}

test("full log reduces to final hp, turns and verdict", async () => {
  const ev = await scriptedTrial();
  const s = reduceEvents(ev);
  const changes = ev.filter((e) => e.type === "hp_change") as EventOf<"hp_change">[];
  expect(s.hp.AEGIS).toBe(changes.filter((e) => e.lawyer === "AEGIS").at(-1)!.hp);
  expect(s.hp.NEMESIS).toBe(10);
  expect(s.first).toBe("AEGIS");
  expect(s.case).toEqual(c);
  expect(s.turns).toHaveLength(10);
  const ends = ev.filter((e) => e.type === "turn_end") as EventOf<"turn_end">[];
  expect(s.turns.map((t) => t.text)).toEqual(ends.map((e) => e.text));
  expect(s.turns[0].penalties).toEqual([expect.objectContaining({ code: "UNSUPPORTED", points: 1 })]);
  expect(s.verdict).toMatchObject({ type: "verdict", ruling: "FOR" });
});

test("prefix ending mid-speech gives partial text and current turn", async () => {
  const ev = await scriptedTrial();
  const firstDelta = ev.findIndex((e) => e.type === "speech_delta");
  const s = reduceEvents(ev.slice(0, firstDelta + 1));
  expect(s.current).toBe(0);
  expect(s.turns[0]).toMatchObject({ lawyer: "AEGIS", phase: "opening", text: "Always " });
});

test("error and knockout are recorded", () => {
  const s = reduceEvents([
    { at: 0, type: "knockout", lawyer: "NEMESIS" },
    { at: 1, type: "error", message: "boom" },
  ]);
  expect(s.knockout).toBe("NEMESIS");
  expect(s.error).toBe("boom");
});

test("reduceEvent does not mutate its input", async () => {
  const ev = await scriptedTrial();
  let s = Object.freeze(initialState());
  for (const e of ev as TrialEvent[]) s = deepFreeze(reduceEvent(s, e));
  expect(s.turns).toHaveLength(10);
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}
