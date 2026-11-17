import { z } from "zod";

const JUDGE_CODES = ["UNSUPPORTED", "REPETITION", "EVASION", "FALLACY", "CONTRADICTION", "SUSTAINED"] as const;

export const RulingInput = z.object({
  penalties: z.array(
    z.object({
      code: z.enum(JUDGE_CODES),
      reason: z.string(),
      quote: z.string(),
      evidence: z.string().optional(),
    }),
  ),
  objection: z.enum(["SUSTAINED", "OVERRULED"]).optional(),
});
export type RulingInput = z.infer<typeof RulingInput>;

export const VerdictInput = z.object({
  ruling: z.enum(["FOR", "AGAINST", "CONDITIONAL"]),
  conditions: z.array(z.string()).optional(),
  confidence: z.number(),
  summary: z.string(),
  turningPoint: z.number().int(),
});
export type VerdictInput = z.infer<typeof VerdictInput>;

// JSON Schemas handed to the model as tool input definitions.
export const rulingToolSchema = z.toJSONSchema(RulingInput);
export const verdictToolSchema = z.toJSONSchema(VerdictInput);
