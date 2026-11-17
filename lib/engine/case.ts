import type { Case } from "./types";

export class CaseError extends Error {}

export const MAX_IDEA = 1000;
export const MAX_CONTEXT = 2000;

export function validateCase(input: { idea: string; context?: string }): Case {
  const idea = input.idea.trim();
  const context = (input.context ?? "").trim();
  if (!idea) throw new CaseError("Describe the idea or decision to put on trial.");
  if (idea.length > MAX_IDEA) throw new CaseError(`The idea must be ${MAX_IDEA} characters or fewer.`);
  if (context.length > MAX_CONTEXT) throw new CaseError(`The context must be ${MAX_CONTEXT} characters or fewer.`);
  return { idea, context };
}

// User text is data, never markup: escaping "<" means it can't close the <case> block.
const escape = (s: string) => s.replace(/</g, "&lt;");

export function wrapCase(c: Case): string {
  return `<case>\n<idea>${escape(c.idea)}</idea>\n<context>${escape(c.context)}</context>\n</case>`;
}
