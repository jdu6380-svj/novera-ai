import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const demoRoot = resolve(fileURLToPath(new URL("./", import.meta.url)));
const manifestPath = resolve(demoRoot, "manifest.json");
const supportedTypes = new Map([
  [".pdf", new Set(["application/pdf"])],
  [".md", new Set(["text/markdown", "text/plain"])],
  [".markdown", new Set(["text/markdown", "text/plain"])],
  [".txt", new Set(["text/plain"])],
]);
const supportedTaskTypes = new Set(["qa", "summary", "analysis", "compare", "recommend"]);
const decoder = new TextDecoder("utf-8", { fatal: true });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function countOccurrences(source, value) {
  let count = 0;
  let offset = 0;

  while (true) {
    const index = source.indexOf(value, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + value.length;
  }
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function parseFlatFrontmatter(source) {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") return {};

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex < 1) return {};

  return Object.fromEntries(
    lines
      .slice(1, closingIndex)
      .map((line) => {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex < 1) return null;
        return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()];
      })
      .filter(Boolean),
  );
}

function markdownHeadings(source) {
  const stack = [];
  const headings = [];

  for (const [index, line] of source.split("\n").entries()) {
    const match = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/u);
    if (!match) continue;

    const level = match[1].length;
    const title = match[2].replace(/[ \t]+#+[ \t]*$/u, "").trim();
    while (stack.length && stack.at(-1).level >= level) stack.pop();
    stack.push({ level, title });
    headings.push({ line: index + 1, level, title, path: stack.map((item) => item.title) });
  }

  return headings;
}

function sectionPathAt(headings, line) {
  return headings.filter((heading) => heading.line <= line).at(-1)?.path ?? [];
}

function sameStrings(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function safeSourcePath(relativePath) {
  invariant(typeof relativePath === "string" && relativePath.length > 0, "Document path is required.");
  const absolutePath = resolve(demoRoot, relativePath);
  invariant(
    absolutePath === demoRoot || absolutePath.startsWith(`${demoRoot}${sep}`),
    `Document path escapes demo/: ${relativePath}`,
  );
  return absolutePath;
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
invariant(isObject(manifest), "manifest.json must contain an object.");
invariant(manifest.schemaVersion === "1.0.0", "Unsupported manifest schemaVersion.");
invariant(manifest.datasetId === "novera-phase6-asteria-demo-v1", "Unexpected datasetId.");
invariant(manifest.company?.fictional === true, "The company must be explicitly fictional.");
invariant(Array.isArray(manifest.documents) && manifest.documents.length >= 3 && manifest.documents.length <= 5, "The manifest must list 3–5 source documents.");
invariant(Array.isArray(manifest.typicalQuestions) && manifest.typicalQuestions.length > 0, "Typical questions are required.");
invariant(Array.isArray(manifest.knowledgeGapCases) && manifest.knowledgeGapCases.length > 0, "At least one knowledge-gap case is required.");

const documentById = new Map();
const sourceById = new Map();
const headingById = new Map();
const listedFiles = new Set();
const observedOrders = [];

for (const document of manifest.documents) {
  invariant(isObject(document), "Each document entry must be an object.");
  invariant(typeof document.fixtureDocumentId === "string" && document.fixtureDocumentId, "fixtureDocumentId is required.");
  invariant(!documentById.has(document.fixtureDocumentId), `Duplicate fixtureDocumentId: ${document.fixtureDocumentId}`);
  invariant(Number.isInteger(document.order), `Document ${document.fixtureDocumentId} requires an integer order.`);
  observedOrders.push(document.order);

  const sourcePath = safeSourcePath(document.path);
  const extension = extname(sourcePath).toLowerCase();
  const allowedMimeTypes = supportedTypes.get(extension);
  invariant(allowedMimeTypes?.has(document.mimeType), `Unsupported upload type for ${document.path}: ${document.mimeType}`);
  invariant(basename(sourcePath) === document.filename, `Filename mismatch for ${document.path}.`);
  invariant(document.path.startsWith("corpus/"), `Upload source must be inside demo/corpus/: ${document.path}`);

  const bytes = await readFile(sourcePath);
  const fileStat = await stat(sourcePath);
  invariant(fileStat.isFile(), `${document.path} is not a file.`);
  invariant(bytes.byteLength > 0, `${document.path} is empty.`);
  invariant(bytes.byteLength <= manifest.uploadContract.maxFileSizeBytes, `${document.path} exceeds the upload limit.`);
  invariant(bytes.byteLength === document.sizeBytes, `Byte size changed for ${document.path}.`);
  invariant(sha256(bytes) === document.contentSha256, `SHA-256 changed for ${document.path}.`);

  let source;
  try {
    source = decoder.decode(bytes);
  } catch (error) {
    throw new Error(`${document.path} is not valid UTF-8.`, { cause: error });
  }

  const frontmatter = parseFlatFrontmatter(source);
  invariant(frontmatter.document_id === document.fixtureDocumentId, `Frontmatter document_id mismatch for ${document.path}.`);
  invariant(frontmatter.fictional === "true", `${document.path} must set fictional: true.`);

  const headings = markdownHeadings(source);
  const firstH1 = headings.find((heading) => heading.level === 1);
  invariant(firstH1?.title === document.expectedTitle, `H1 title mismatch for ${document.path}.`);

  documentById.set(document.fixtureDocumentId, document);
  sourceById.set(document.fixtureDocumentId, source);
  headingById.set(document.fixtureDocumentId, headings);
  listedFiles.add(document.filename);
}

invariant(
  sameStrings(observedOrders, [...observedOrders].sort((left, right) => left - right)) &&
    new Set(observedOrders).size === observedOrders.length,
  "Document order values must be unique and ascending.",
);

const corpusFiles = (await readdir(resolve(demoRoot, "corpus")))
  .filter((filename) => supportedTypes.has(extname(filename).toLowerCase()))
  .sort();
invariant(sameStrings(corpusFiles, [...listedFiles].sort()), "Every supported file in demo/corpus/ must be listed exactly once in the manifest.");

const referencedDocuments = new Set();
const questionIds = new Set();
const allCases = [...manifest.typicalQuestions, ...manifest.knowledgeGapCases];
invariant(allCases.length >= 15 && allCases.length <= 20, "The Golden Dataset must contain 15–20 questions.");
invariant(manifest.knowledgeGapCases.length >= 3, "The Golden Dataset must include at least three refusal cases.");

for (const testCase of allCases) {
  invariant(isObject(testCase), "Each question case must be an object.");
  invariant(typeof testCase.id === "string" && testCase.id, "Question id is required.");
  invariant(!questionIds.has(testCase.id), `Duplicate question id: ${testCase.id}`);
  questionIds.add(testCase.id);
  invariant(supportedTaskTypes.has(testCase.taskType), `Unsupported task type in ${testCase.id}.`);
  invariant(typeof testCase.question === "string" && testCase.question.trim(), `Question text is required in ${testCase.id}.`);
  invariant(Array.isArray(testCase.expectedDocuments), `expectedDocuments must be an array in ${testCase.id}.`);
  invariant(Array.isArray(testCase.expectedEvidence), `expectedEvidence must be an array in ${testCase.id}.`);
  invariant(Array.isArray(testCase.expectedAnswerPoints) && testCase.expectedAnswerPoints.length > 0, `Expected answer points are required in ${testCase.id}.`);

  if (testCase.expectedOutcome === "supported") {
    invariant(testCase.expectedDocuments.length > 0, `Supported case ${testCase.id} requires expected documents.`);
    invariant(testCase.expectedEvidence.length > 0, `Supported case ${testCase.id} requires expected evidence.`);
  } else {
    invariant(testCase.expectedOutcome === "insufficient_evidence", `Unknown expectedOutcome in ${testCase.id}.`);
    invariant(testCase.expectedEvidence.length === 0, `Knowledge-gap case ${testCase.id} must not prescribe evidence.`);
  }

  for (const documentId of testCase.expectedDocuments) {
    invariant(documentById.has(documentId), `Unknown expected document ${documentId} in ${testCase.id}.`);
    referencedDocuments.add(documentId);
  }

  for (const evidence of testCase.expectedEvidence) {
    invariant(isObject(evidence), `Evidence entry must be an object in ${testCase.id}.`);
    const document = documentById.get(evidence.documentFixtureId);
    invariant(document, `Unknown evidence document ${evidence.documentFixtureId} in ${testCase.id}.`);
    invariant(testCase.expectedDocuments.includes(evidence.documentFixtureId), `Evidence document must be listed in expectedDocuments for ${testCase.id}.`);
    invariant(typeof evidence.quote === "string" && evidence.quote.length > 0, `Evidence quote is required in ${testCase.id}.`);
    invariant(isObject(evidence.locator), `Evidence locator is required in ${testCase.id}.`);

    const source = sourceById.get(evidence.documentFixtureId);
    const occurrences = countOccurrences(source, evidence.quote);
    invariant(occurrences === 1, `Evidence quote in ${testCase.id} must occur exactly once; found ${occurrences}.`);
    const quoteIndex = source.indexOf(evidence.quote);
    const lineStart = lineNumberAt(source, quoteIndex);
    const lineEnd = lineStart + evidence.quote.split("\n").length - 1;
    invariant(evidence.locator.lineStart === lineStart, `lineStart mismatch for evidence in ${testCase.id}.`);
    invariant(evidence.locator.lineEnd === lineEnd, `lineEnd mismatch for evidence in ${testCase.id}.`);

    const actualSectionPath = sectionPathAt(headingById.get(evidence.documentFixtureId), lineStart);
    invariant(
      sameStrings(actualSectionPath, evidence.sectionPath),
      `Section path mismatch in ${testCase.id}: expected ${JSON.stringify(evidence.sectionPath)}, got ${JSON.stringify(actualSectionPath)}.`,
    );
  }
}

for (const documentId of documentById.keys()) {
  invariant(referencedDocuments.has(documentId), `Document ${documentId} is not covered by any typical question.`);
}

const background = await readFile(resolve(demoRoot, "company-background.md"), "utf8");
invariant(background.includes("Fictional portfolio dataset."), "Company background must retain the fiction disclaimer.");

console.log(
  [
    "DEMO_DATASET_VALID",
    `dataset=${manifest.datasetId}`,
    `documents=${manifest.documents.length}`,
    `supported_questions=${manifest.typicalQuestions.length}`,
    `knowledge_gap_cases=${manifest.knowledgeGapCases.length}`,
    `evidence_quotes=${manifest.typicalQuestions.reduce((count, item) => count + item.expectedEvidence.length, 0)}`,
  ].join(" "),
);
