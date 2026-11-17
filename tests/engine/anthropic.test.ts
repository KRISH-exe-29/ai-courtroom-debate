import { expect, test } from "vitest";
import { createAnthropicClient, JUDGE_MODEL, usd, type Usage } from "@/lib/engine/anthropic";

function stubFetch(responseBody: unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const verdict = { ruling: "FOR", confidence: 80, summary: "Sound plan.", turningPoint: 3 };
const message = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: JUDGE_MODEL,
  content: [{ type: "text", text: JSON.stringify(verdict) }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
};

test("callJudge returns parsed structured output and sends the expected request", async () => {
  const { fetch, calls } = stubFetch(message);
  const seen: Usage[] = [];
  const client = createAnthropicClient("sk-test", { fetch, onUsage: (u) => seen.push(u) });

  const out = await client.callJudge({ system: "SYS", prompt: "PROMPT", tool: "verdict" });

  expect(out).toEqual(verdict);
  const body = calls[0].body;
  expect(body.model).toBe("claude-opus-5-5");
  expect(body.tool_choice).toBeUndefined();
  expect(body).toMatchObject({
    fallbacks: "default",
    system: [{ type: "text", text: "SYS", cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema" } },
    messages: [{ role: "user", content: "PROMPT" }],
  });
  expect(seen).toEqual([{ model: "claude-opus-5-5", input: 1200, output: 300, cacheRead: 800, cacheWrite: 0 }]);
});

test("callJudge returns null on a refusal so the engine can retry", async () => {
  const { fetch } = stubFetch({ ...message, content: [], stop_reason: "refusal" });
  const out = await createAnthropicClient("sk-test", { fetch }).callJudge({ system: "S", prompt: "P", tool: "ruling" });
  expect(out).toBeNull();
});

test("usd prices tokens per model", () => {
  // Opus 5.5: $4 in, $20 out, $0.20 cache read, $5 cache write per million tokens.
  expect(usd({ model: "claude-opus-5-5", input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 })).toBeCloseTo(29.2);
  expect(usd({ model: "claude-sonnet-5-5", input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(2);
  expect(usd({ model: "unknown-model", input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBeNaN();
});

test("callJudge returns null when a refusal leaves partial JSON", async () => {
  const { fetch } = stubFetch({ ...message, content: [{ type: "text", text: '{"penalties":[' }], stop_reason: "refusal" });
  await expect(createAnthropicClient("sk-test", { fetch }).callJudge({ system: "S", prompt: "P", tool: "ruling" })).resolves.toBeNull();
});

test("callJudge returns null when output is cut off at max_tokens", async () => {
  const { fetch } = stubFetch({ ...message, content: [{ type: "text", text: '{"ruling":"FOR","confid' }], stop_reason: "max_tokens" });
  await expect(createAnthropicClient("sk-test", { fetch }).callJudge({ system: "S", prompt: "P", tool: "verdict" })).resolves.toBeNull();
});

test("callJudge still throws API errors so the trial reports them", async () => {
  const fetch = (async () =>
    new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }), {
      status: 400, headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
  await expect(createAnthropicClient("sk-test", { fetch }).callJudge({ system: "S", prompt: "P", tool: "ruling" })).rejects.toThrow();
});
