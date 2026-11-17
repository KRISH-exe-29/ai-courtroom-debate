import { expect, test } from "vitest";
import { advance, newSession, recordAnswer, renderRequest, type Session } from "@/lib/node/court-session";

const c = { idea: "Should I learn Rust?", context: "" };

test("a new session asks the first speaker for an opening statement", async () => {
  const { pending, events } = await advance(newSession(c, "NEMESIS"));
  expect(events.map((e) => e.type)).toEqual(["filed", "turn_start"]);
  expect(pending).toMatchObject({ kind: "lawyer", lawyer: "NEMESIS" });
  expect(pending && renderRequest(pending)).toMatch(/"speech"/);
});

test("answers replay through the real engine; the judge request is blinded", async () => {
  let s: Session = newSession(c, "AEGIS");
  s = recordAnswer(s, (await advance(s)).pending!, { speech: "Rust pays off within a year." });
  const { pending } = await advance(s);
  expect(pending).toMatchObject({ kind: "judge", tool: "ruling" });
  expect(pending!.prompt).not.toMatch(/aegis|nemesis/i);
  expect(pending!.system).not.toMatch(/aegis|nemesis/i);
});

test("invalid answers are rejected with a reason, and the session is unchanged", async () => {
  const s = newSession(c, "AEGIS");
  const lawyerReq = (await advance(s)).pending!;
  expect(() => recordAnswer(s, lawyerReq, { speech: "" })).toThrow(/speech/);
  expect(() => recordAnswer(s, lawyerReq, { speech: "x", objection: { ground: "SHOUTING", quote: "q" } })).toThrow(/ground/);
  expect(s.answers).toHaveLength(0);
});

test("a full trial played step by step ends with the verdict", async () => {
  let s = newSession(c, "AEGIS");
  for (let step = 0; step < 50; step++) {
    const { pending, events } = await advance(s);
    if (!pending) {
      expect(events.at(-1)).toMatchObject({ type: "verdict", ruling: "FOR" });
      expect(events.filter((e) => e.type === "turn_end")).toHaveLength(10);
      return;
    }
    const answer =
      pending.kind === "lawyer"
        ? { speech: `Turn by ${pending.lawyer}.`, objection: { ground: "NONE", quote: "" } }
        : pending.tool === "ruling"
          ? { penalties: [] }
          : { ruling: "FOR", confidence: 60, summary: "Fine.", turningPoint: 3 };
    s = recordAnswer(s, pending, answer);
  }
  throw new Error("trial did not finish");
});
