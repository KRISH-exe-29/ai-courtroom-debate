import { createAnthropicClient, JUDGE_MODEL, LAWYER_MODEL, type Usage } from "./anthropic";
import type { ModelClient } from "./client";
import { createOpenAICompatibleClient } from "./openai-compatible";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
export const GEMINI_DEFAULT_MODEL = "gemini-4-hydrogen";

export type ProviderConfig = {
  provider: "anthropic" | "openai-compatible";
  baseUrl?: string;
  apiKey?: string;
  lawyerModel: string;
  judgeModel: string;
  /** Human-readable model line for reports and the CLI. */
  label: string;
  make: (onUsage?: (u: Usage) => void) => ModelClient;
};

type Env = Record<string, string | undefined>;

/**
 * Picks the model provider from settings, first match wins:
 * ANTHROPIC_API_KEY → Claude; GEMINI_API_KEY → Gemini; OPENAI_COMPAT_BASE_URL → any OpenAI-compatible server.
 * LAWYER_MODEL / JUDGE_MODEL override the model names for the OpenAI-compatible providers.
 */
export function resolveProvider(env: Env): ProviderConfig {
  const done = (c: Omit<ProviderConfig, "label">): ProviderConfig => ({ ...c, label: `lawyers ${c.lawyerModel} · judge ${c.judgeModel}` });

  if (env.ANTHROPIC_API_KEY) {
    const apiKey = env.ANTHROPIC_API_KEY;
    return done({
      provider: "anthropic", apiKey, lawyerModel: LAWYER_MODEL, judgeModel: JUDGE_MODEL,
      make: (onUsage) => createAnthropicClient(apiKey, { onUsage }),
    });
  }

  const compat = (baseUrl: string, apiKey: string | undefined, lawyerModel: string, judgeModel: string) =>
    done({
      provider: "openai-compatible", baseUrl, apiKey, lawyerModel, judgeModel,
      make: (onUsage) => createOpenAICompatibleClient({ baseUrl, apiKey, lawyerModel, judgeModel, onUsage }),
    });

  if (env.GEMINI_API_KEY) {
    return compat(GEMINI_BASE_URL, env.GEMINI_API_KEY, env.LAWYER_MODEL || GEMINI_DEFAULT_MODEL, env.JUDGE_MODEL || GEMINI_DEFAULT_MODEL);
  }

  if (env.OPENAI_COMPAT_BASE_URL) {
    if (!env.LAWYER_MODEL || !env.JUDGE_MODEL) throw new Error("Set LAWYER_MODEL and JUDGE_MODEL for OPENAI_COMPAT_BASE_URL.");
    return compat(env.OPENAI_COMPAT_BASE_URL, env.OPENAI_COMPAT_API_KEY || undefined, env.LAWYER_MODEL, env.JUDGE_MODEL);
  }

  throw new Error(
    "No model provider configured. Set one of: ANTHROPIC_API_KEY (Claude), GEMINI_API_KEY (Gemini), " +
      "or OPENAI_COMPAT_BASE_URL with LAWYER_MODEL and JUDGE_MODEL (Ollama, Groq, OpenRouter…) in .env.local.",
  );
}
