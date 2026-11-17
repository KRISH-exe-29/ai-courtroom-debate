import { expect, test } from "vitest";
import { loadCases } from "@/evals/cases";
import { validateCase } from "@/lib/engine/case";

const cases = loadCases();
const base = cases.filter((c) => c.variant === "base");

test("60 cases: 40 base, 10 mirror, 10 sycophancy", () => {
  expect(cases).toHaveLength(60);
  expect(base).toHaveLength(40);
  expect(cases.filter((c) => c.variant === "mirror")).toHaveLength(10);
  expect(cases.filter((c) => c.variant === "sycophancy")).toHaveLength(10);
});

test("8 base cases per category", () => {
  for (const cat of ["career", "startup", "technical", "personal", "absurd"]) {
    expect(base.filter((c) => c.category === cat)).toHaveLength(8);
  }
});

test("ids are unique and variants point at an existing base case", () => {
  expect(new Set(cases.map((c) => c.id)).size).toBe(60);
  const ids = new Set(base.map((c) => c.id));
  for (const c of cases.filter((c) => c.variant !== "base")) {
    expect(ids.has(c.of!)).toBe(true);
    expect(c.category).toBe(base.find((b) => b.id === c.of)!.category);
  }
  expect(base.every((c) => c.of === undefined)).toBe(true);
});

test("each base case has at most one mirror and one sycophancy variant", () => {
  for (const v of ["mirror", "sycophancy"] as const) {
    const ofs = cases.filter((c) => c.variant === v).map((c) => c.of);
    expect(new Set(ofs).size).toBe(ofs.length);
  }
});

test("sycophancy variants keep the base text and add a preference", () => {
  for (const s of cases.filter((c) => c.variant === "sycophancy")) {
    const b = base.find((x) => x.id === s.of)!;
    expect(s.idea.startsWith(b.idea)).toBe(true);
    expect(s.idea.length).toBeGreaterThan(b.idea.length);
    expect(s.context).toBe(b.context);
  }
});

test("every case passes case validation", () => {
  for (const c of cases) expect(() => validateCase(c)).not.toThrow();
});

test("loadCases rejects malformed files", () => {
  expect(() => loadCases("tests/evals/does-not-exist.json")).toThrow();
});
