import { expect, test } from "vitest";
import { runTrial } from "@/lib/engine/trial";
import type { LawyerChunk } from "@/lib/engine/client";
import type { EventOf, TrialEvent } from "@/lib/engine/types";
import { collect, fakeClient } from "../fake-client";

const c = { idea: "Quit my job", context: "" };
const of = <T extends TrialEvent["type"]>(ev: TrialEvent[], t: T) => ev.filter((e) => e.type === t) as EventOf<T>[];

test("full trial: 10 turns, 10 rulings, then a verdict", async () => {
  const ev = await collect(runTrial(c, fakeClient(), { first: "AEGIS" }));
  expect(ev[0]).toMatchObject({ type: "filed", case: c, first: "AEGIS" });
  expect(of(ev, "turn_start")).toHaveLength(10);
  expect(of(ev, "ruling")).toHaveLength(10);
  expect(ev.at(-1)).toMatchObject({ type: "verdict", ruling: "FOR" });
});

test("first speaker is forced or drawn from random", async () => {
  expect((await collect(runTrial(c, fakeClient(), { first: "NEMESIS" })))[0]).toMatchObject({ first: "NEMESIS" });
  expect((await collect(runTrial(c, fakeClient(), { random: () => 0.9 })))[0]).toMatchObject({ first: "NEMESIS" });
  expect((await collect(runTrial(c, fakeClient(), { random: () => 0.1 })))[0]).toMatchObject({ first: "AEGIS" });
  const ev = await collect(runTrial(c, fakeClient(), { first: "NEMESIS" }));
  expect(of(ev, "turn_start")[0]).toMatchObject({ lawyer: "NEMESIS", phase: "opening" });
});

test("speech deltas concatenate to the turn_end text", async () => {
  const ev = await collect(
    runTrial(c, fakeClient({ lawyer: [[{ type: "text", text: "Hello " }, { type: "text", text: "court." }]] }), { first: "AEGIS" }),
  );
  expect(of(ev, "speech_delta").filter((e) => e.turn === 0).map((e) => e.text).join("")).toBe("Hello court.");
  expect(of(ev, "turn_end")[0].text).toBe("Hello court.");
});

test("judge never sees character names", async () => {
  const f = fakeClient({
    lawyer: [
      [{ type: "text", text: "As AEGIS, I say yes" }],
      [{ type: "text", text: "Nemesis disagrees" }, { type: "objection", ground: "RELEVANCE", quote: "As AEGIS, I say yes" }],
    ],
  });
  await collect(runTrial(c, f, { first: "AEGIS" }));
  expect(f.judgePrompts.length).toBeGreaterThan(0);
  for (const p of f.judgePrompts) expect(p).not.toMatch(/aegis|nemesis/i);
});

test("valid objection is emitted and a sustained ruling costs the opponent", async () => {
  const ev = await collect(
    runTrial(
      c,
      fakeClient({
        lawyer: [
          [{ type: "text", text: "It will surely succeed." }],
          [{ type: "text", text: "No." }, { type: "objection", ground: "SPECULATION", quote: "surely succeed" }],
        ],
        rulings: [{ penalties: [] }, { penalties: [], objection: "SUSTAINED" }],
      }),
      { first: "AEGIS" },
    ),
  );
  expect(of(ev, "objection")).toEqual([expect.objectContaining({ turn: 1, by: "NEMESIS", ground: "SPECULATION" })]);
  expect(of(ev, "ruling")[1]).toMatchObject({ objection: "SUSTAINED" });
  expect(of(ev, "hp_change")[0]).toMatchObject({ lawyer: "AEGIS", code: "SUSTAINED", hp: 9 });
});

test("invalid objections are dropped: turn 0, unknown ground, bad quote, third by same lawyer", async () => {
  const obj = (quote: string, ground = "RELEVANCE"): LawyerChunk => ({ type: "objection", ground: ground as "RELEVANCE", quote });
  const t = (text: string, ...o: LawyerChunk[]): LawyerChunk[] => [{ type: "text", text }, ...o];
  const ev = await collect(
    runTrial(
      c,
      fakeClient({
        lawyer: [
          t("a0", obj("anything")), // turn 0: nothing to object to
          t("n1", obj("a0", "MADE_UP")), // unknown ground
          t("a2", obj("not said")), // quote not in previous turn
          t("n3", obj("a2")), // valid, NEMESIS #1
          t("a4"),
          t("n5", obj("a4")), // valid, NEMESIS #2
          t("a6"),
          t("n7", obj("a6")), // NEMESIS #3: over the cap
        ],
      }),
      { first: "AEGIS" },
    ),
  );
  expect(of(ev, "objection").map((e) => e.turn)).toEqual([3, 5]);
});

test("invalid ruling twice gives a skipped ruling and the trial continues", async () => {
  const ev = await collect(runTrial(c, fakeClient({ rulings: ["junk", { penalties: "no" }] }), { first: "AEGIS" }));
  expect(of(ev, "ruling")[0]).toMatchObject({ turn: 0, penalties: [], dropped: 0, skipped: true });
  expect(of(ev, "turn_start")).toHaveLength(10);
});

test("invalid ruling once is retried", async () => {
  const ev = await collect(
    runTrial(
      c,
      fakeClient({
        lawyer: [[{ type: "text", text: "always" }]],
        rulings: ["junk", { penalties: [{ code: "UNSUPPORTED", reason: "r", quote: "always" }] }],
      }),
      { first: "AEGIS" },
    ),
  );
  expect(of(ev, "ruling")[0]).toMatchObject({ penalties: [expect.objectContaining({ code: "UNSUPPORTED" })] });
  expect(of(ev, "ruling")[0].skipped).toBeUndefined();
});

test("knockout on turn 0 ends the trial and still issues a verdict", async () => {
  const k = { code: "CONTRADICTION", reason: "r", quote: "x", evidence: "Quit my job" };
  const ev = await collect(
    runTrial(
      c,
      fakeClient({
        lawyer: [[{ type: "text", text: "x y z w" }]],
        rulings: [{ penalties: [k, k, k, k] }],
        verdict: { ruling: "AGAINST", confidence: 90, summary: "s", turningPoint: 7 },
      }),
      { first: "AEGIS" },
    ),
  );
  expect(of(ev, "turn_start")).toHaveLength(1);
  expect(of(ev, "knockout")).toEqual([expect.objectContaining({ lawyer: "AEGIS" })]);
  expect(ev.at(-1)).toMatchObject({ type: "verdict", ruling: "AGAINST", turningPoint: 0 });
});

test("client error mid-trial yields an error event instead of throwing", async () => {
  const ev = await collect(runTrial(c, fakeClient({ throwAtTurn: 3 }), { first: "AEGIS" }));
  expect(ev.at(-1)).toMatchObject({ type: "error", message: "network down" });
  expect(of(ev, "turn_start")).toHaveLength(4);
});

test("invalid verdict twice yields an error event", async () => {
  const ev = await collect(runTrial(c, fakeClient({ verdict: "junk" }), { first: "AEGIS" }));
  expect(ev.at(-1)).toMatchObject({ type: "error" });
});

test("at is monotonic and starts near zero", async () => {
  let t = 1000;
  const ev = await collect(runTrial(c, fakeClient(), { first: "AEGIS", now: () => (t += 5) }));
  const at = ev.map((e) => e.at);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  expect(at[0]).toBeLessThan(20);
});

test("penalty quoting the blinded text still matches the turn", async () => {
  const ev = await collect(
    runTrial(
      c,
      fakeClient({
        lawyer: [[{ type: "text", text: "Trust AEGIS, it always works." }]],
        rulings: [{ penalties: [{ code: "UNSUPPORTED", reason: "r", quote: "Trust Side A, it always works" }] }],
      }),
      { first: "AEGIS" },
    ),
  );
  expect(of(ev, "ruling")[0]).toMatchObject({ dropped: 0, penalties: [expect.objectContaining({ code: "UNSUPPORTED" })] });
});
