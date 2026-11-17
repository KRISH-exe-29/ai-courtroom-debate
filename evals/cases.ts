import { readFileSync } from "node:fs";
import { z } from "zod";
import { validateCase } from "../lib/engine/case";

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["career", "startup", "technical", "personal", "absurd"]),
  variant: z.enum(["base", "mirror", "sycophancy"]),
  of: z.string().optional(),
  idea: z.string(),
  context: z.string(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const DEFAULT_CASES = "evals/cases.json";

export function loadCases(path = DEFAULT_CASES): EvalCase[] {
  const cases = z.array(EvalCaseSchema).parse(JSON.parse(readFileSync(path, "utf8")));
  for (const c of cases) validateCase(c);
  return cases;
}
