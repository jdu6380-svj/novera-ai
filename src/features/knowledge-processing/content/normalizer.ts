import type { JsonObject } from "@/domain";

import type {
  ParsedBlockKind,
  ParsedContentBlock,
  ParsedDocument,
  ParsedSourceDocument,
  SourceLocator,
} from "./parser";

export interface NormalizedContentBlock {
  id: string;
  sourceBlockId: string;
  kind: Exclude<ParsedBlockKind, "heading">;
  /** Normalized text used for retrieval and chunk construction. */
  text: string;
  /** Parser output retained for evidence display and auditability. */
  sourceText: string;
  locator: SourceLocator;
  metadata: JsonObject;
}

export interface NormalizedSection {
  id: string;
  title: string;
  level: number;
  path: string[];
  parentSectionId: string | null;
  headingSourceBlockId: string | null;
  headingSourceText: string | null;
  headingLocator: SourceLocator | null;
  blocks: NormalizedContentBlock[];
  text: string;
  locator: SourceLocator;
}

export interface NormalizedDocument {
  source: ParsedSourceDocument;
  title: string;
  metadata: JsonObject;
  parser: {
    name: string;
    version: string;
  };
  normalizer: {
    name: string;
    version: string;
  };
  sections: NormalizedSection[];
  text: string;
  pageCount: number | null;
  charCount: number;
}

interface MutableSection extends NormalizedSection {
  blocks: NormalizedContentBlock[];
}

const EMPTY_LOCATOR: SourceLocator = {
  pageStart: null,
  pageEnd: null,
  lineStart: null,
  lineEnd: null,
  startChar: null,
  endChar: null,
};

function minNullable(first: number | null, second: number | null): number | null {
  if (first === null) {
    return second;
  }

  if (second === null) {
    return first;
  }

  return Math.min(first, second);
}

function maxNullable(first: number | null, second: number | null): number | null {
  if (first === null) {
    return second;
  }

  if (second === null) {
    return first;
  }

  return Math.max(first, second);
}

export function mergeSourceLocators(
  first: SourceLocator | null,
  second: SourceLocator | null,
): SourceLocator {
  if (!first && !second) {
    return { ...EMPTY_LOCATOR };
  }

  if (!first) {
    return { ...(second ?? EMPTY_LOCATOR) };
  }

  if (!second) {
    return { ...first };
  }

  return {
    pageStart: minNullable(first.pageStart, second.pageStart),
    pageEnd: maxNullable(first.pageEnd, second.pageEnd),
    lineStart: minNullable(first.lineStart, second.lineStart),
    lineEnd: maxNullable(first.lineEnd, second.lineEnd),
    startChar: minNullable(first.startChar, second.startChar),
    endChar: maxNullable(first.endChar, second.endChar),
  };
}

function normalizeUnicodeAndNewlines(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n|\r/g, "\n");
}

function normalizeBlockText(block: ParsedContentBlock): string {
  const text = normalizeUnicodeAndNewlines(block.text);

  if (block.kind === "code") {
    return text
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      .replace(/^\n+|\n+$/g, "");
  }

  if (block.kind === "list") {
    return text
      .split("\n")
      .map((line) => line.trim().replace(/[ \t]+/g, " "))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizedHeading(block: ParsedContentBlock): string {
  return normalizeBlockText(block);
}

function sectionId(index: number): string {
  return `section-${String(index).padStart(4, "0")}`;
}

function createSection(input: {
  index: number;
  title: string;
  level: number;
  path: string[];
  parentSectionId: string | null;
  headingBlock?: ParsedContentBlock;
}): MutableSection {
  const headingLocator = input.headingBlock?.locator ?? null;

  return {
    id: sectionId(input.index),
    title: input.title,
    level: input.level,
    path: input.path,
    parentSectionId: input.parentSectionId,
    headingSourceBlockId: input.headingBlock?.id ?? null,
    headingSourceText: input.headingBlock?.text ?? null,
    headingLocator,
    blocks: [],
    text: "",
    locator: headingLocator ? { ...headingLocator } : { ...EMPTY_LOCATOR },
  };
}

function normalizedContentBlock(
  block: ParsedContentBlock,
): NormalizedContentBlock | null {
  if (block.kind === "heading") {
    return null;
  }

  const text = normalizeBlockText(block);

  if (!text) {
    return null;
  }

  return {
    id: block.id,
    sourceBlockId: block.id,
    kind: block.kind,
    text,
    sourceText: block.text,
    locator: { ...block.locator },
    metadata: block.metadata,
  };
}

function finalizeSections(sections: readonly MutableSection[]): NormalizedSection[] {
  return sections.map((section) => ({
    ...section,
    blocks: [...section.blocks],
    text: section.blocks.map((block) => block.text).join("\n\n"),
  }));
}

export class NormalizerLayer {
  readonly name = "novera-document-normalizer";
  readonly version = "1.0.0";

  normalize(parsed: ParsedDocument): NormalizedDocument {
    const documentTitle =
      normalizeUnicodeAndNewlines(parsed.title ?? parsed.source.displayName).trim() ||
      parsed.source.displayName;
    const hasExplicitHeadings = parsed.blocks.some(
      (block) => block.kind === "heading" && normalizedHeading(block).length > 0,
    );
    const sections: MutableSection[] = [];
    const headingStack: Array<{ level: number; section: MutableSection }> = [];
    const pageSections = new Map<number, MutableSection>();
    let currentSection: MutableSection | null = null;

    const addSection = (
      input: Omit<Parameters<typeof createSection>[0], "index">,
    ): MutableSection => {
      const section = createSection({ ...input, index: sections.length });
      sections.push(section);
      return section;
    };

    const rootSection = (): MutableSection => {
      const existingRoot = sections.find(
        (section) => section.level === 0 && section.headingSourceBlockId === null,
      );

      if (existingRoot) {
        return existingRoot;
      }

      return addSection({
        title: documentTitle,
        level: 0,
        path: [documentTitle],
        parentSectionId: null,
      });
    };

    for (const block of parsed.blocks) {
      if (block.kind === "heading") {
        const title = normalizedHeading(block);

        if (!title) {
          continue;
        }

        const level = Math.min(6, Math.max(1, block.headingLevel ?? 1));

        while (
          headingStack.length > 0 &&
          (headingStack.at(-1)?.level ?? 0) >= level
        ) {
          headingStack.pop();
        }

        const parent = headingStack.at(-1)?.section ?? null;
        currentSection = addSection({
          title,
          level,
          path: parent ? [...parent.path, title] : [title],
          parentSectionId: parent?.id ?? null,
          headingBlock: block,
        });
        headingStack.push({ level, section: currentSection });
        continue;
      }

      const normalizedBlock = normalizedContentBlock(block);

      if (!normalizedBlock) {
        continue;
      }

      if (!hasExplicitHeadings && block.locator.pageStart !== null) {
        const pageNumber = block.locator.pageStart;
        currentSection = pageSections.get(pageNumber) ?? null;

        if (!currentSection) {
          const pageTitle = `Page ${pageNumber}`;
          currentSection = addSection({
            title: pageTitle,
            level: 1,
            path: [pageTitle],
            parentSectionId: null,
          });
          pageSections.set(pageNumber, currentSection);
        }
      } else if (!currentSection) {
        currentSection = rootSection();
      }

      currentSection.blocks.push(normalizedBlock);
      currentSection.locator = mergeSourceLocators(
        currentSection.locator,
        normalizedBlock.locator,
      );
    }

    const finalizedSections = finalizeSections(sections);
    const normalizedText = finalizedSections
      .map((section) =>
        section.text
          ? `${section.path.join(" > ")}\n\n${section.text}`
          : section.path.join(" > "),
      )
      .filter(Boolean)
      .join("\n\n");

    return {
      source: parsed.source,
      title: documentTitle,
      metadata: {
        source: parsed.source.metadata,
        extracted: parsed.metadata,
      },
      parser: parsed.parser,
      normalizer: { name: this.name, version: this.version },
      sections: finalizedSections,
      text: normalizedText,
      pageCount: parsed.pageCount,
      charCount: normalizedText.length,
    };
  }
}

const defaultNormalizer = new NormalizerLayer();

export function normalizeDocument(parsed: ParsedDocument): NormalizedDocument {
  return defaultNormalizer.normalize(parsed);
}
