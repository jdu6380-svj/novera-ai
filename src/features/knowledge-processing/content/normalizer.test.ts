import { describe, expect, it } from "vitest";

import { NormalizerLayer } from "./normalizer";
import { MarkdownDocumentParser, type DocumentProcessingSource } from "./parser";

const source: DocumentProcessingSource = {
  documentId: "00000000-0000-4000-8000-000000000011",
  displayName: "Retention Notes",
  mimeType: "text/markdown",
  fileExtension: "md",
  metadata: { sourceSystem: "notion" },
  content: new TextEncoder().encode(
    "# Retention Notes\n\n## Activation\n\n  Users  do not know\nwhat to do next.  \n",
  ),
};

describe("Normalizer Layer", () => {
  it("normalizes whitespace while preserving heading hierarchy and source metadata", async () => {
    const parsed = await new MarkdownDocumentParser().parse(source);
    const normalized = new NormalizerLayer().normalize(parsed);

    expect(normalized.title).toBe("Retention Notes");
    expect(normalized.metadata.source).toEqual({ sourceSystem: "notion" });
    expect(normalized.sections.map((section) => section.path)).toEqual([
      ["Retention Notes"],
      ["Retention Notes", "Activation"],
    ]);
    expect(normalized.sections[1]?.parentSectionId).toBe(normalized.sections[0]?.id);
    expect(normalized.sections[1]?.blocks[0]?.text).toBe(
      "Users do not know what to do next.",
    );
    expect(normalized.sections[1]?.blocks[0]?.sourceText).toContain("Users  do not know");
  });
});
