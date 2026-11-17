import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Usage } from "@/lib/engine/anthropic";
import { RulingInput } from "@/lib/engine/schema";
import { createAgentCliClient, detectAgent, dropNulls, resolveLocalProvider, strictSchema, type RunCommand } from "@/lib/node/agent-cli";
import { collect } from "../fake-client";

type Call = { cmd: string; args: string[]; stdin: string; cwd: string };

/** Fake process runner: records each call and answers with `reply(call)`. */
function fakeRun(reply: (c: Call) => { code?: number; stdout?: string; stderr?: string }) {
  const calls: Call[] = [];
  const run: RunCommand = async (cmd, args, { stdin, cwd }) => {
    const call = { cmd, args, stdin, cwd };
    calls.push(call);
    const r = reply(call);
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { run, calls };
}

const claudeOut = (structured: unknown) =>
  JSON.stringify({
    is_error: false,
    structured_output: structured,
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 100 },
    modelUsage: { "claude-opus-5-5": {} },
  });

const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test("Claude Code judge call runs headless with the user's setup switched off and returns the structured answer", async () => {
  const ruling = { penalties: [{ code: "FALLACY", reason: "r", quote: "q", evidence: null }], objection: null };
  const { run, calls } = fakeRun(() => ({ stdout: claudeOut(ruling) }));
  const usage: Usage[] = [];
  const client = createAgentCliClient({ agent: "claude-code", run, onUsage: (u) => usage.push(u) });

  expect(await client.callJudge({ system: "SYS", prompt: "PROMPT", tool: "ruling" })).toEqual({
    penalties: [{ code: "FALLACY", reason: "r", quote: "q" }],
  });

  const { cmd, args, stdin } = calls[0];
  expect(cmd).toBe("claude");
  expect(stdin).toBe("PROMPT");
  for (const flag of ["-p", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--exclude-dynamic-system-prompt-sections"]) {
    expect(args).toContain(flag);
  }
  expect(argAfter(args, "--tools")).toBe("");
  expect(argAfter(args, "--setting-sources")).toBe("");
  expect(argAfter(args, "--system-prompt")).toBe("SYS");
  expect(argAfter(args, "--output-format")).toBe("json");
  expect(argAfter(args, "--effort")).toBe("medium");
  expect(JSON.parse(argAfter(args, "--json-schema")).required).toEqual(["penalties", "objection"]);
  expect(usage).toEqual([{ model: "claude-opus-5-5", input: 10, output: 20, cacheRead: 5, cacheWrite: 100 }]);
});

test("Claude Code lawyer turn yields the speech and an objection unless the ground is NONE", async () => {
  for (const [objection, expected] of [
    [{ ground: "SPECULATION", quote: "surely" }, [{ type: "objection", ground: "SPECULATION", quote: "surely" }]],
    [{ ground: "NONE", quote: "" }, []],
  ] as const) {
    const { run, calls } = fakeRun(() => ({ stdout: claudeOut({ speech: "It will fail.", objection }) }));
    const chunks = await collect(createAgentCliClient({ agent: "claude-code", run, model: "sonnet" }).streamLawyer({ lawyer: "AEGIS", system: "S", prompt: "P" }));
    expect(chunks).toEqual([{ type: "text", text: "It will fail." }, ...expected]);
    expect(argAfter(calls[0].args, "--effort")).toBe("low");
    expect(argAfter(calls[0].args, "--model")).toBe("sonnet");
  }
});

test("Codex call passes the schema as a file, reads the last message, and reports token usage", async () => {
  const { run, calls } = fakeRun((c) => {
    const schema = JSON.parse(readFileSync(join(c.cwd, argAfter(c.args, "--output-schema")), "utf8"));
    expect(schema.additionalProperties).toBe(false);
    writeFileSync(join(c.cwd, argAfter(c.args, "-o")), JSON.stringify({ ruling: "FOR", conditions: null, confidence: 70, summary: "s", turningPoint: 3 }));
    return { stdout: '{"type":"turn.started"}\n{"type":"turn.completed","usage":{"input_tokens":300,"cached_input_tokens":100,"output_tokens":40}}\n' };
  });
  const usage: Usage[] = [];
  const client = createAgentCliClient({ agent: "codex", run, onUsage: (u) => usage.push(u) });

  expect(await client.callJudge({ system: "SYS", prompt: "PROMPT", tool: "verdict" })).toEqual({ ruling: "FOR", confidence: 70, summary: "s", turningPoint: 3 });
  const { cmd, args, stdin } = calls[0];
  expect(cmd).toBe("codex");
  expect(args.slice(0, 1)).toEqual(["exec"]);
  for (const flag of ["--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--json"]) expect(args).toContain(flag);
  expect(argAfter(args, "-s")).toBe("read-only");
  expect(args.at(-1)).toBe("-");
  expect(stdin).toContain("SYS");
  expect(stdin).toContain("PROMPT");
  expect(usage).toEqual([{ model: "codex", input: 200, output: 40, cacheRead: 100, cacheWrite: 0 }]);
});

test("a failed agent process throws with its error output; unparseable judge output is null", async () => {
  const failing = fakeRun(() => ({ code: 1, stderr: "not logged in" }));
  await expect(createAgentCliClient({ agent: "claude-code", run: failing.run }).callJudge({ system: "S", prompt: "P", tool: "ruling" })).rejects.toThrow(/not logged in/);
  const junk = fakeRun(() => ({ stdout: "not json" }));
  expect(await createAgentCliClient({ agent: "claude-code", run: junk.run }).callJudge({ system: "S", prompt: "P", tool: "ruling" })).toBeNull();
});

test("strictSchema makes every property required and optional ones nullable; dropNulls undoes it", () => {
  const s = strictSchema(RulingInput) as { required: string[]; properties: Record<string, { anyOf?: unknown[] }> };
  expect(s.required).toEqual(["penalties", "objection"]);
  expect(s.properties.objection.anyOf).toContainEqual({ type: "null" });
  expect(dropNulls({ a: null, b: [{ c: null, d: 1 }] })).toEqual({ b: [{ d: 1 }] });
});

test("detectAgent honours AGENT_CLI, then finds Claude Code, then Codex", () => {
  expect(detectAgent({ AGENT_CLI: "codex" }, () => false)).toBe("codex");
  expect(detectAgent({}, (c) => c === "claude" || c === "codex")).toBe("claude-code");
  expect(detectAgent({}, (c) => c === "codex")).toBe("codex");
  expect(detectAgent({}, () => false)).toBeUndefined();
});

test("resolveLocalProvider prefers API keys, falls back to an installed agent, and explains when nothing is set up", () => {
  expect(resolveLocalProvider({ GEMINI_API_KEY: "g" }, () => true).provider).toBe("openai-compatible");
  const agent = resolveLocalProvider({}, (c) => c === "codex");
  expect(agent).toMatchObject({ provider: "agent-cli", label: "agent codex (your login)" });
  expect(resolveLocalProvider({ AGENT_CLI: "claude-code", GEMINI_API_KEY: "g" }, () => false).provider).toBe("agent-cli");
  expect(() => resolveLocalProvider({}, () => false)).toThrow(/Claude Code or Codex/);
});
