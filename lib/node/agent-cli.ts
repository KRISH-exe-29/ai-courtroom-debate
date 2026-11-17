// Node-only: runs trials on a coding agent the user already has (Claude Code or Codex), using their login
// instead of an API key. Each lawyer turn and judge ruling is a separate headless call, so the judge stays
// blind and independent exactly as with an API provider.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Usage } from "../engine/anthropic";
import type { ModelClient } from "../engine/client";
import { resolveProvider, type ProviderConfig } from "../engine/providers";
import { GROUNDS } from "../engine/rubric";
import { RulingInput, VerdictInput } from "../engine/schema";
import type { ObjectionGround } from "../engine/types";

export type AgentName = "claude-code" | "codex";
const AGENTS: Record<AgentName, string> = { "claude-code": "claude", codex: "codex" };

export type RunCommand = (
  cmd: string,
  args: string[],
  opts: { stdin: string; cwd: string },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

const TIMEOUT_MS = 5 * 60_000;

export const runCommand: RunCommand = (cmd, args, { stdin, cwd }) =>
  new Promise((resolve, reject) => {
    // Codex installs as an npm .cmd launcher on Windows, which needs a shell. Everything passed to it is a flag
    // or a file name; prompts always go through stdin. Claude Code installs as a native executable: no shell.
    const shell = process.platform === "win32" && cmd !== "claude";
    const argv = shell ? args.map((a) => (a === "" || /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
    const child = spawn(cmd, argv, { cwd, shell, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${cmd} timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });

/** JSON schema accepted by strict structured-output modes: every property required, optional ones nullable. */
export function strictSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...root } = z.toJSONSchema(schema) as Record<string, unknown>;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const n = { ...(node as Record<string, unknown>) };
    delete n.minimum; // integer bounds from zod are the safe-integer range; strict modes may reject them
    delete n.maximum;
    for (const key of ["items", "anyOf"]) if (n[key]) n[key] = walk(n[key]);
    if (n.properties) {
      const props = n.properties as Record<string, unknown>;
      const required = new Set((n.required as string[] | undefined) ?? []);
      n.properties = Object.fromEntries(
        Object.entries(props).map(([k, v]) => [k, required.has(k) ? walk(v) : { anyOf: [walk(v), { type: "null" }] }]),
      );
      n.required = Object.keys(props);
      n.additionalProperties = false;
    }
    return n;
  };
  return walk(root) as Record<string, unknown>;
}

/** Removes null-valued properties (the "absent" form of a strict schema's optional fields). */
export function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, dropNulls(v)]));
}

const LawyerReply = z.object({
  speech: z.string(),
  objection: z.object({
    ground: z.enum(["NONE", ...Object.keys(GROUNDS)] as [string, ...string[]]),
    quote: z.string(),
  }),
});
const SCHEMAS = { lawyer: strictSchema(LawyerReply), ruling: strictSchema(RulingInput), verdict: strictSchema(VerdictInput) };

const LAWYER_FORMAT =
  "\n\nReply as JSON: `speech` is your full turn. To object to your opponent's previous turn, set `objection` " +
  'to a ground and their exact words; otherwise set its ground to "NONE" and quote to "".';

const tail = (s: string) => s.trim().slice(-500);

export function createAgentCliClient(o: {
  agent: AgentName;
  model?: string;
  run?: RunCommand;
  onUsage?: (u: Usage) => void;
}): ModelClient {
  const run = o.run ?? runCommand;
  let dir: string | undefined;
  // An empty working folder keeps project files and instructions out of every call.
  const workdir = () => (dir ??= mkdtempSync(join(tmpdir(), "courtroom-agent-")));
  let seq = 0;

  async function claude(system: string, prompt: string, schema: object, effort: string): Promise<unknown> {
    const args = [
      "-p",
      "--output-format", "json",
      // The user's own setup (settings, plugins, MCP servers, skills, tools) is switched off: it is not needed
      // and would add hundreds of thousands of tokens to every call.
      "--tools", "",
      "--setting-sources", "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--exclude-dynamic-system-prompt-sections",
      "--system-prompt", system,
      "--json-schema", JSON.stringify(schema),
      "--effort", effort,
      ...(o.model ? ["--model", o.model] : []),
    ];
    const r = await run(AGENTS["claude-code"], args, { stdin: prompt, cwd: workdir() });
    if (r.code !== 0) throw new Error(`Claude Code exited with ${r.code}: ${tail(r.stderr || r.stdout)}`);
    let out: {
      is_error?: boolean;
      structured_output?: unknown;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
      modelUsage?: Record<string, unknown>;
    };
    try {
      out = JSON.parse(r.stdout);
    } catch {
      return undefined;
    }
    const u = out.usage;
    if (u) {
      o.onUsage?.({
        model: Object.keys(out.modelUsage ?? {})[0] ?? o.model ?? "claude-code",
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      });
    }
    return out.is_error ? undefined : out.structured_output;
  }

  async function codex(system: string, prompt: string, schema: object, effort: string): Promise<unknown> {
    const cwd = workdir();
    const id = `${process.pid}-${++seq}`;
    const schemaFile = `schema-${id}.json`;
    const outFile = `reply-${id}.json`;
    writeFileSync(join(cwd, schemaFile), JSON.stringify(schema));
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--disable", "plugins",
      "--disable", "apps",
      "-s", "read-only",
      "--output-schema", schemaFile,
      "-o", outFile,
      "--json",
      "-c", `model_reasoning_effort=${effort}`,
      ...(o.model ? ["-m", o.model] : []),
      "-",
    ];
    const r = await run(AGENTS.codex, args, { stdin: `<instructions>\n${system}\n</instructions>\n\n${prompt}`, cwd });
    if (r.code !== 0) throw new Error(`Codex exited with ${r.code}: ${tail(r.stderr || r.stdout)}`);
    for (const line of r.stdout.split("\n")) {
      if (!line.includes('"turn.completed"')) continue;
      try {
        const u = JSON.parse(line).usage ?? {};
        const cached = u.cached_input_tokens ?? 0;
        o.onUsage?.({ model: o.model ?? "codex", input: (u.input_tokens ?? 0) - cached, output: u.output_tokens ?? 0, cacheRead: cached, cacheWrite: 0 });
      } catch {}
    }
    const outPath = join(cwd, outFile);
    if (!existsSync(outPath)) return undefined;
    try {
      return JSON.parse(readFileSync(outPath, "utf8"));
    } catch {
      return undefined;
    }
  }

  const call = o.agent === "claude-code" ? claude : codex;

  return {
    async *streamLawyer({ system, prompt }) {
      const raw = await call(system + LAWYER_FORMAT, prompt, SCHEMAS.lawyer, "low");
      const reply = LawyerReply.safeParse(dropNulls(raw));
      if (!reply.success) throw new Error(`${o.agent} returned no usable speech`);
      yield { type: "text", text: reply.data.speech };
      const { ground, quote } = reply.data.objection;
      if (ground !== "NONE") yield { type: "objection", ground: ground as ObjectionGround, quote };
    },
    async callJudge({ system, prompt, tool }) {
      const raw = await call(system, prompt, SCHEMAS[tool], "medium");
      return raw === undefined ? null : dropNulls(raw); // the engine validates, retries once, then skips
    },
  };
}

const commandExists = (cmd: string) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0;

/** AGENT_CLI picks the agent explicitly; otherwise the first one installed: Claude Code, then Codex. */
export function detectAgent(env: Record<string, string | undefined>, has: (cmd: string) => boolean = commandExists): AgentName | undefined {
  if (env.AGENT_CLI) {
    if (env.AGENT_CLI in AGENTS) return env.AGENT_CLI as AgentName;
    throw new Error(`AGENT_CLI must be one of: ${Object.keys(AGENTS).join(", ")}.`);
  }
  return (Object.keys(AGENTS) as AgentName[]).find((a) => has(AGENTS[a]));
}

/** Provider for local scripts: API keys first, then an installed coding agent (or AGENT_CLI to force one). */
export function resolveLocalProvider(env: Record<string, string | undefined>, has: (cmd: string) => boolean = commandExists): ProviderConfig {
  const agentProvider = (agent: AgentName): ProviderConfig => {
    const model = env.AGENT_MODEL || undefined;
    return {
      provider: "agent-cli",
      lawyerModel: model ?? agent,
      judgeModel: model ?? agent,
      label: `agent ${agent}${model ? ` ${model}` : ""} (your login)`,
      make: (onUsage) => createAgentCliClient({ agent, model, onUsage }),
    };
  };
  if (env.AGENT_CLI) return agentProvider(detectAgent(env, has)!);
  try {
    return resolveProvider(env);
  } catch (e) {
    const agent = detectAgent(env, has);
    if (agent) return agentProvider(agent);
    throw new Error(`${(e as Error).message} Or install Claude Code or Codex and log in: trials then run on your agent's account.`);
  }
}
