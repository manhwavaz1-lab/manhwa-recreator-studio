import { describe, expect, it } from "vitest";
import { buildWebVtt, extractJson } from "./studio";

describe("studio utilities", () => {
  it("extracts JSON wrapped in a markdown code fence", () => {
    const fence = String.fromCharCode(96).repeat(3);
    expect(extractJson<{ title: string }>(fence + 'json\n{"title":"Capítulo 1"}\n' + fence)).toEqual({ title: "Capítulo 1" });
  });

  it("rejects a response without a JSON object", () => {
    expect(() => extractJson("sem json")).toThrow("não contém JSON válido");
  });

  it("builds valid WebVTT cues from a script", () => {
    const result = buildWebVtt("A história começa. O herói desperta!");
    expect(result.startsWith("WEBVTT\n\n")).toBe(true);
    expect(result).toContain("00:00:00.000 -->");
    expect(result).toContain("A história começa.");
    expect(result).toContain("O herói desperta!");
  });

  it("returns an empty WebVTT for an empty script", () => {
    expect(buildWebVtt("")).toBe("WEBVTT\n\n");
  });
});
