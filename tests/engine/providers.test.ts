import { expect, test } from "vitest";
import { GEMINI_BASE_URL, resolveProvider } from "@/lib/engine/providers";

test("Anthropic key selects the Claude models", () => {
  expect(resolveProvider({ ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" })).toMatchObject({
    provider: "anthropic", lawyerModel: "claude-sonnet-5-5", judgeModel: "claude-opus-5-5",
  });
});

test("Gemini key selects Gemini's OpenAI endpoint with a default model", () => {
  expect(resolveProvider({ GEMINI_API_KEY: "g" })).toMatchObject({
    provider: "openai-compatible", baseUrl: GEMINI_BASE_URL, apiKey: "g", lawyerModel: "gemini-4-hydrogen", judgeModel: "gemini-4-hydrogen",
  });
});

test("explicit OpenAI-compatible server needs model names and allows no key", () => {
  expect(resolveProvider({ OPENAI_COMPAT_BASE_URL: "http://localhost:11434/v1", LAWYER_MODEL: "llama", JUDGE_MODEL: "qwen" })).toMatchObject({
    provider: "openai-compatible", baseUrl: "http://localhost:11434/v1", apiKey: undefined, lawyerModel: "llama", judgeModel: "qwen",
  });
  expect(() => resolveProvider({ OPENAI_COMPAT_BASE_URL: "http://localhost:11434/v1" })).toThrow(/LAWYER_MODEL/);
});

test("LAWYER_MODEL and JUDGE_MODEL override defaults", () => {
  expect(resolveProvider({ GEMINI_API_KEY: "g", JUDGE_MODEL: "j" })).toMatchObject({ lawyerModel: "gemini-4-hydrogen", judgeModel: "j" });
});

test("no configuration is an error that lists the options", () => {
  expect(() => resolveProvider({})).toThrow(/ANTHROPIC_API_KEY.*GEMINI_API_KEY.*OPENAI_COMPAT_BASE_URL/);
});

test("label names the models for reports", () => {
  expect(resolveProvider({ GEMINI_API_KEY: "g", LAWYER_MODEL: "x" }).label).toBe("lawyers x · judge gemini-4-hydrogen");
});
