import type { LawyerChunk, ModelClient } from "@/lib/engine/client";

export type FakeScript = {
  lawyer?: LawyerChunk[][];
  rulings?: unknown[];
  verdict?: unknown;
  throwAtTurn?: number;
};

/** Scripted ModelClient: lawyer turns, judge rulings (one per call, retries included) and a verdict. */
export function fakeClient(script: FakeScript = {}) {
  let lawyerCalls = 0;
  let rulingCalls = 0;
  const judgePrompts: string[] = [];
  const client: ModelClient & { judgePrompts: string[] } = {
    judgePrompts,
    async *streamLawyer() {
      const n = lawyerCalls++;
      if (script.throwAtTurn === n) throw new Error("network down");
      for (const ch of script.lawyer?.[n] ?? [{ type: "text", text: `arg ${n}` }]) yield ch;
    },
    async callJudge(req) {
      judgePrompts.push(`${req.system}\n${req.prompt}`);
      if (req.tool === "verdict") return script.verdict ?? { ruling: "FOR", confidence: 70, summary: "s", turningPoint: 0 };
      return script.rulings?.[rulingCalls++] ?? { penalties: [] };
    },
  };
  return client;
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
