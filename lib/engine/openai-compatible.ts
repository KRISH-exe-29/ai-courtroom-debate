import { z } from "zod";
import type { Usage } from "./anthropic";
import type { LawyerChunk, ModelClient } from "./client";
import { GROUNDS } from "./rubric";
import { RulingInput, VerdictInput } from "./schema";
import type { ObjectionGround } from "./types";

/**
 * ModelClient for any server that speaks the OpenAI Chat Completions format:
 * Gemini's OpenAI endpoint, Ollama, Groq, OpenRouter and others.
 */
export type OpenAICompatibleOptions = {
  baseUrl: string;
  apiKey?: string;
  lawyerModel: string;
  judgeModel: string;
  onUsage?: (u: Usage) => void;
  fetch?: typeof fetch;
  /** Base delay for retries on 429/5xx; the server's retry-after header wins when present. */
  retryDelayMs?: number;
};

const MAX_RETRIES = 2;

const OBJECT_TOOL = {
  type: "function",
  function: {
    name: "object",
    description: "Object to your opponent's previous turn. Call at most once, after your speech.",
    parameters: {
      type: "object",
      properties: {
        ground: { type: "string", enum: Object.keys(GROUNDS) },
        quote: { type: "string", description: "The opponent's exact words you object to." },
      },
      required: ["ground", "quote"],
    },
  },
};

const jsonSchema = (schema: z.ZodType) => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
};
const SCHEMAS = { ruling: jsonSchema(RulingInput), verdict: jsonSchema(VerdictInput) };

type ApiUsage = { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createOpenAICompatibleClient(o: OpenAICompatibleOptions): ModelClient {
  const doFetch = o.fetch ?? fetch;
  const url = `${o.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.apiKey) headers.authorization = `Bearer ${o.apiKey}`;

  const report = (model: string, u?: ApiUsage) => {
    if (!u) return;
    const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
    o.onUsage?.({ model, input: (u.prompt_tokens ?? 0) - cached, output: u.completion_tokens ?? 0, cacheRead: cached, cacheWrite: 0 });
  };

  async function post(body: Record<string, unknown>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        const text = await res.text();
        let message = text;
        try {
          message = JSON.parse(text)?.error?.message ?? text;
        } catch {}
        throw new Error(`HTTP ${res.status}: ${message}`.slice(0, 500));
      }
      const after = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && res.headers.has("retry-after") ? after * 1000 : (o.retryDelayMs ?? 1000) * 2 ** attempt);
    }
  }

  return {
    async *streamLawyer({ system, prompt }) {
      const res = await post({
        model: o.lawyerModel,
        stream: true,
        stream_options: { include_usage: true },
        reasoning_effort: "low",
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        tools: [OBJECT_TOOL],
        tool_choice: "auto",
      });

      const calls = new Map<number, { name: string; args: string }>();
      let finish: string | null = null;
      for await (const data of sseData(res)) {
        if (data === "[DONE]") break;
        const chunk = JSON.parse(data) as {
          choices?: { delta?: { content?: string | null; tool_calls?: { index: number; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
          usage?: ApiUsage;
        };
        if (chunk.usage) report(o.lawyerModel, chunk.usage);
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;
        if (choice.delta?.content) yield { type: "text", text: choice.delta.content } satisfies LawyerChunk;
        for (const tc of choice.delta?.tool_calls ?? []) {
          const call = calls.get(tc.index) ?? { name: "", args: "" };
          call.name += tc.function?.name ?? "";
          call.args += tc.function?.arguments ?? "";
          calls.set(tc.index, call);
        }
      }

      if (finish === "length") return; // a truncated tool call is not trustworthy
      for (const call of calls.values()) {
        if (call.name !== "object") continue;
        try {
          const input = JSON.parse(call.args) as { ground?: unknown; quote?: unknown };
          if (typeof input.ground === "string" && typeof input.quote === "string") {
            yield { type: "objection", ground: input.ground as ObjectionGround, quote: input.quote };
          }
        } catch {
          // malformed arguments: no objection
        }
      }
    },

    async callJudge({ system, prompt, tool }) {
      const res = await post({
        model: o.judgeModel,
        reasoning_effort: "medium",
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        response_format: { type: "json_schema", json_schema: { name: tool, schema: SCHEMAS[tool] } },
      });
      const body = (await res.json()) as {
        choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
        usage?: ApiUsage;
      };
      report(o.judgeModel, body.usage);
      const choice = body.choices?.[0];
      if (!choice?.message?.content || choice.message.refusal || choice.finish_reason !== "stop") return null;
      try {
        return JSON.parse(choice.message.content);
      } catch {
        return null; // the engine retries once, then skips the ruling
      }
    },
  };
}

/** Yields the `data:` payload of each server-sent event, tolerating events split across network chunks. */
async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += value;
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = done ? "" : events.pop()!;
    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) yield data;
    }
    if (done) return;
  }
}
