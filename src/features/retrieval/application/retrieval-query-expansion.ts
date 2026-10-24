type TermExpansion = {
  source: RegExp;
  target: string;
};

const TERM_EXPANSIONS: readonly TermExpansion[] = [
  { source: /准时交付率/u, target: "on-time delivery rate" },
  { source: /准时送达率/u, target: "on-time delivery rate" },
  { source: /一次检验合格率/u, target: "first-pass yield" },
  { source: /设备采购预算/u, target: "equipment purchase budget" },
  { source: /研发预算/u, target: "research and development budget" },
  { source: /营业收入/u, target: "revenue" },
  { source: /夜班(?:单独)?产量/u, target: "night-shift output" },
  { source: /退货批次/u, target: "returned batches" },
];

export function expandBilingualRetrievalQuery(query: string): {
  embeddingQuery: string;
  embeddingQueries: string[];
  terms: string[];
} {
  const terms = TERM_EXPANSIONS
    .filter((item) => item.source.test(query))
    .map((item) => item.target);
  const requestsYearGrain = /\b20\d{2}\s*年/u.test(query) &&
    !/(?:\b20\d{2}\s*年\s*)?\d{1,2}\s*月/u.test(query);
  if (requestsYearGrain && /一次检验合格率/u.test(query)) {
    terms.push("annual first-pass yield");
  }

  return {
    embeddingQuery: terms.length > 0 ? `${query}\nSearch terms: ${terms.join("; ")}` : query,
    embeddingQueries: [...new Set([query, ...terms])],
    terms,
  };
}
