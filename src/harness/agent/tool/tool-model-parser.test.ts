import { describe, expect, test } from "bun:test";
import { toolPartToModel, type ToolPart } from "./tool-model-parser";

const websearchPart = (overrides: Partial<ToolPart>): ToolPart => ({
  type: "tool-websearch",
  state: "output-available",
  input: { query: "bun runtime" },
  output: {
    query: "bun runtime",
    results: [{ title: "Bun", url: "https://bun.sh", snippet: "fast", content: null }],
  },
  ...overrides,
});

describe("toolPartToModel status", () => {
  test("final output renders as success", () => {
    const model = toolPartToModel(websearchPart({}));
    expect(model?.status).toBe("success");
  });

  test("preliminary output renders as running with streamed progress", () => {
    const model = toolPartToModel(
      websearchPart({
        preliminary: true,
        output: { progress: "Fetching result 1 of 2…", results: [] },
      }),
    );
    expect(model?.status).toBe("running");
    if (model?.name === "websearch") {
      expect(model.progress).toBe("Fetching result 1 of 2…");
      expect(model.results).toEqual([]);
    } else {
      throw new Error("expected websearch model");
    }
  });

  test("input-available renders as running before any output", () => {
    const model = toolPartToModel(websearchPart({ state: "input-available", output: undefined }));
    expect(model?.status).toBe("running");
  });

  test("output-error renders as error", () => {
    const model = toolPartToModel(websearchPart({ state: "output-error", errorText: "boom" }));
    expect(model?.status).toBe("error");
    expect(model?.error).toBe("boom");
  });
});

describe("toolPartToModel webfetch progress", () => {
  test("preliminary progress chunk surfaces the progress note", () => {
    const model = toolPartToModel({
      type: "tool-webfetch",
      state: "output-available",
      preliminary: true,
      input: { url: "https://example.com" },
      output: { progress: "Rendering in headless Chrome…" },
    });
    expect(model?.status).toBe("running");
    if (model?.name === "webfetch") {
      expect(model.progress).toBe("Rendering in headless Chrome…");
      expect(model.output).toBeUndefined();
    } else {
      throw new Error("expected webfetch model");
    }
  });

  test("final output carries content and no progress", () => {
    const model = toolPartToModel({
      type: "tool-webfetch",
      state: "output-available",
      input: { url: "https://example.com" },
      output: { url: "https://example.com", contentType: "text/html", content: "# Hi" },
    });
    expect(model?.status).toBe("success");
    if (model?.name === "webfetch") {
      expect(model.output).toBe("# Hi");
      expect(model.progress).toBeUndefined();
    } else {
      throw new Error("expected webfetch model");
    }
  });
});

describe("toolPartToModel skill", () => {
  test("running renders from the input name only", () => {
    const model = toolPartToModel({
      type: "tool-skill",
      state: "input-available",
      input: { name: "opentui" },
    });
    expect(model?.status).toBe("running");
    if (model?.name === "skill") {
      expect(model.skill).toBe("opentui");
      expect(model.content).toBeUndefined();
      expect(model.files).toBeUndefined();
    } else {
      throw new Error("expected skill model");
    }
  });

  test("final output carries the loaded skill", () => {
    const model = toolPartToModel({
      type: "tool-skill",
      state: "output-available",
      input: { name: "opentui" },
      output: {
        name: "opentui",
        description: "Build terminal UIs with OpenTUI.",
        skillFile: "/x/.agents/skills/opentui/SKILL.md",
        skillDir: "/x/.agents/skills/opentui",
        files: ["SKILL.md", "docs/core.mdx"],
        content: "# OpenTUI Skill",
      },
    });
    expect(model?.status).toBe("success");
    if (model?.name === "skill") {
      expect(model.skill).toBe("opentui");
      expect(model.description).toBe("Build terminal UIs with OpenTUI.");
      expect(model.skillDir).toBe("/x/.agents/skills/opentui");
      expect(model.files).toEqual(["SKILL.md", "docs/core.mdx"]);
      expect(model.content).toBe("# OpenTUI Skill");
    } else {
      throw new Error("expected skill model");
    }
  });

  test("output errors surface the error text", () => {
    const model = toolPartToModel({
      type: "tool-skill",
      state: "output-error",
      input: { name: "nope" },
      errorText: 'Unknown skill: "nope"',
    });
    expect(model?.status).toBe("error");
    if (model?.name === "skill") {
      expect(model.error).toBe('Unknown skill: "nope"');
      expect(model.skill).toBe("nope");
    } else {
      throw new Error("expected skill model");
    }
  });
});
