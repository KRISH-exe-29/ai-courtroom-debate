import { expect, test } from "vitest";
import { createOpenAICompatibleClient } from "@/lib/engine/openai-compatible";
import type { Usage } from "@/lib/engine/anthropic";
import { collect } from "../fake-client";

type Call = { url: string; headers: Headers; body: Record<string, unknown> };

/** Stub fetch that answers each call with the next queued Response factory. */
function stubFetch(...responses: (() => Response)[]) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return responses[Math.min(calls.length - 1, responses.length - 1)]();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const sse = (...chunks: unknown[]) => () =>
  new Response(chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

const completion = (content: string, finish = "stop") => ({
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }],
  usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 300 } },
});

const opts = (fetch: typeof globalThis.fetch, extra: Partial<Parameters<typeof createOpenAICompatibleClient>[0]> = {}) => ({
  baseUrl: "https://example.test/v1/",
  apiKey: "key-123",
  lawyerModel: "lawyer-m",
  judgeModel: "judge-m",
  fetch,
  retryDelayMs: 0,
  ...extra,
});

test("callJudge sends a JSON-schema request and returns the parsed object", async () => {
  const verdict = { ruling: "FOR", confidence: 80, summary: "ok", turningPoint: 2 };
  const { fetch, calls } = stubFetch(json(completion(JSON.stringify(verdict))));
  const usage: Usage[] = [];
  const client = createOpenAICompatibleClient(opts(fetch, { onUsage: (u) => usage.push(u) }));

  expect(await client.callJudge({ system: "SYS", prompt: "PROMPT", tool: "verdict" })).toEqual(verdict);

  const { url, headers, body } = calls[0];
  expect(url).toBe("https://example.test/v1/chat/completions");
  expect(headers.get("authorization")).toBe("Bearer key-123");
  expect(body).toMatchObject({
    model: "judge-m",
    reasoning_effort: "medium",
    messages: [{ role: "system", content: "SYS" }, { role: "user", content: "PROMPT" }],
    response_format: { type: "json_schema", json_schema: { name: "verdict" } },
  });
  const schema = (body.response_format as { json_schema: { schema: Record<string, unknown> } }).json_schema.schema;
  expect(schema.$schema).toBeUndefined();
  expect(schema.required).toContain("ruling");
  expect(usage).toEqual([{ model: "judge-m", input: 700, output: 200, cacheRead: 300, cacheWrite: 0 }]);
});

test("callJudge returns null for invalid JSON, truncation or a filtered reply", async () => {
  for (const r of [completion("{not json"), completion('{"penalties":[', "length"), completion("", "content_filter")]) {
    const { fetch } = stubFetch(json(r));
    expect(await createOpenAICompatibleClient(opts(fetch)).callJudge({ system: "S", prompt: "P", tool: "ruling" })).toBeNull();
  }
});

test("HTTP errors throw with the status, after retrying rate limits and server errors", async () => {
  const { fetch, calls } = stubFetch(json({ error: { message: "slow down" } }, 429, { "retry-after": "0" }), json({}, 503), json(completion('{"penalties":[]}')));
  expect(await createOpenAICompatibleClient(opts(fetch)).callJudge({ system: "S", prompt: "P", tool: "ruling" })).toEqual({ penalties: [] });
  expect(calls).toHaveLength(3);

  const bad = stubFetch(json({ error: { message: "bad model" } }, 400));
  await expect(createOpenAICompatibleClient(opts(bad.fetch)).callJudge({ system: "S", prompt: "P", tool: "ruling" })).rejects.toThrow(/400.*bad model/);
  expect(bad.calls).toHaveLength(1);

  const always = stubFetch(json({ error: { message: "busy" } }, 429, { "retry-after": "0" }));
  await expect(createOpenAICompatibleClient(opts(always.fetch)).callJudge({ system: "S", prompt: "P", tool: "ruling" })).rejects.toThrow(/429/);
  expect(always.calls).toHaveLength(3);
});

test("no API key means no Authorization header (local servers)", async () => {
  const { fetch, calls } = stubFetch(json(completion('{"penalties":[]}')));
  await createOpenAICompatibleClient(opts(fetch, { apiKey: undefined })).callJudge({ system: "S", prompt: "P", tool: "ruling" });
  expect(calls[0].headers.get("authorization")).toBeNull();
});

const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] });

test("streamLawyer streams text and assembles an objection from tool-call fragments", async () => {
  const { fetch, calls } = stubFetch(
    sse(
      delta({ role: "assistant", content: "It will " }),
      delta({ content: "fail." }),
      delta({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "object", arguments: '{"ground":"SPECU' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: 'LATION","quote":"surely"}' } }] }, "tool_calls"),
      { choices: [], usage: { prompt_tokens: 50, completion_tokens: 20 } },
      "[DONE]",
    ),
  );
  const usage: Usage[] = [];
  const chunks = await collect(
    createOpenAICompatibleClient(opts(fetch, { onUsage: (u) => usage.push(u) })).streamLawyer({ lawyer: "AEGIS", system: "SYS", prompt: "P" }),
  );
  expect(chunks).toEqual([
    { type: "text", text: "It will " },
    { type: "text", text: "fail." },
    { type: "objection", ground: "SPECULATION", quote: "surely" },
  ]);
  expect(calls[0].body).toMatchObject({ model: "lawyer-m", stream: true, reasoning_effort: "low", tool_choice: "auto" });
  expect(usage).toEqual([{ model: "lawyer-m", input: 50, output: 20, cacheRead: 0, cacheWrite: 0 }]);
});

test("streamLawyer drops a tool call cut off by the length limit or with broken arguments", async () => {
  for (const [args, finish] of [['{"ground":"RELEV', "length"], ["not json", "tool_calls"]]) {
    const { fetch } = stubFetch(
      sse(delta({ content: "x" }), delta({ tool_calls: [{ index: 0, function: { name: "object", arguments: args } }] }, finish), "[DONE]"),
    );
    const chunks = await collect(createOpenAICompatibleClient(opts(fetch)).streamLawyer({ lawyer: "AEGIS", system: "S", prompt: "P" }));
    expect(chunks).toEqual([{ type: "text", text: "x" }]);
  }
});

test("streamLawyer handles SSE events split across network chunks", async () => {
  const body = `data: ${JSON.stringify(delta({ content: "Hel" }))}\n\ndata: ${JSON.stringify(delta({ content: "lo" }))}\n\ndata: [DONE]\n\n`;
  const fetch = (async () =>
    new Response(
      new ReadableStream({
        start(c) {
          const enc = new TextEncoder();
          for (let i = 0; i < body.length; i += 7) c.enqueue(enc.encode(body.slice(i, i + 7)));
          c.close();
        },
      }),
      { status: 200 },
    )) as typeof globalThis.fetch;
  const chunks = await collect(createOpenAICompatibleClient(opts(fetch)).streamLawyer({ lawyer: "AEGIS", system: "S", prompt: "P" }));
  expect(chunks.map((c) => (c.type === "text" ? c.text : "")).join("")).toBe("Hello");
});
