import type { Lawyer, ObjectionGround } from "./types";

export type LawyerChunk = { type: "text"; text: string } | { type: "objection"; ground: ObjectionGround; quote: string };

/** The only surface the engine needs from a language model. Tests swap in a scripted fake. */
export interface ModelClient {
  streamLawyer(req: { lawyer: Lawyer; system: string; prompt: string }): AsyncIterable<LawyerChunk>;
  /** Returns the raw tool input; the engine validates it. */
  callJudge(req: { system: string; prompt: string; tool: "ruling" | "verdict" }): Promise<unknown>;
}
