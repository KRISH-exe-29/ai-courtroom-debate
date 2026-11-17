import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { LawyerChunk, ModelClient } from "./client";
import { GROUNDS } from "./rubric";
import { RulingInput, VerdictInput } from "./schema";
import type { ObjectionGround } from "./types";

export const LAWYER_MODEL = "claude-sonnet-5-5";
export const JUDGE_MODEL = "claude-opus-5-5";

// Re-runs a refused request on a fallback model inside the same call.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type Usage = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number };

/** USD per million tokens. Cache writes are the 5-minute TTL rate (1.25× input). */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  [LAWYER_MODEL]: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  [JUDGE_MODEL]: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export function usd(u: Usage): number {
  const p = PRICES[u.model];
  if (!p) return NaN;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
}

const OBJECT_TOOL = {
  name: "object",
  description: "Object to your opponent's previous turn. Call at most once, after your speech.",
  input_schema: {
    type: "object" as const,
    properties: {
      ground: { type: "string", enum: Object.keys(GROUNDS) },
      quote: { type: "string", description: "The opponent's exact words you object to." },
    },
    required: ["ground", "quote"],
    additionalProperties: false,
  },
  eager_input_streaming: true,
};

const SCHEMAS = { ruling: RulingInput, verdict: VerdictInput };

export function createAnthropicClient(
  apiKey: string,
  opts: { browser?: boolean; onUsage?: (u: Usage) => void; fetch?: typeof fetch } = {},
): ModelClient {
  const sdk = new Anthropic({ apiKey, dangerouslyAllowBrowser: opts.browser ?? false, ...(opts.fetch ? { fetch: opts.fetch } : {}) });

  const report = (requested: string, model: string, u: Anthropic.Beta.BetaUsage) =>
    opts.onUsage?.({
      // A fallback may serve the request; price by the requested model if the served one is unknown.
      model: PRICES[model] ? model : requested,
      input: u.input_tokens,
      output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
    });

  const system = (text: string) => [{ type: "text" as const, text, cache_control: { type: "ephemeral" as const } }];

  return {
    async *streamLawyer({ system: sys, prompt }) {
      const stream = sdk.beta.messages.stream({
        model: LAWYER_MODEL,
        max_tokens: 8000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system: system(sys),
        output_config: { effort: "low" },
        tools: [OBJECT_TOOL],
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: prompt }],
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text } satisfies LawyerChunk;
        }
      }
      const final = await stream.finalMessage();
      report(LAWYER_MODEL, final.model, final.usage);
      if (final.stop_reason === "max_tokens") return; // a truncated tool input is not trustworthy
      for (const block of final.content) {
        if (block.type === "tool_use" && block.name === "object") {
          const input = block.input as { ground?: unknown; quote?: unknown };
          if (typeof input.ground === "string" && typeof input.quote === "string") {
            yield { type: "objection", ground: input.ground as ObjectionGround, quote: input.quote };
          }
        }
      }
    },

    async callJudge({ system: sys, prompt, tool }) {
      const response = await sdk.beta.messages.parse({
        model: JUDGE_MODEL,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system: system(sys),
        output_config: { effort: "medium", format: betaZodOutputFormat(SCHEMAS[tool]) },
        messages: [{ role: "user", content: prompt }],
      });
      report(JUDGE_MODEL, response.model, response.usage);
      if (response.stop_reason === "refusal") return null;
      return response.parsed_output ?? null;
    },
  };
}
