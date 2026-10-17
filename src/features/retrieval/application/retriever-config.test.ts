import { describe, expect, it } from "vitest";

import { getRetrieverConfig } from "./retriever-config";

describe("getRetrieverConfig", () => {
  it("returns bounded MVP defaults", () => {
    expect(getRetrieverConfig({})).toEqual({
      defaultTopK: 12,
      maximumTopK: 50,
      defaultSimilarityThreshold: 0.35,
      maximumQueryCharacters: 4_000,
    });
  });

  it("reads valid retrieval settings", () => {
    expect(
      getRetrieverConfig({
        RETRIEVAL_DEFAULT_TOP_K: "16",
        RETRIEVAL_MAX_TOP_K: "24",
        RETRIEVAL_SIMILARITY_THRESHOLD: "0.42",
        RETRIEVAL_MAX_QUERY_CHARACTERS: "2000",
      }),
    ).toEqual({
      defaultTopK: 16,
      maximumTopK: 24,
      defaultSimilarityThreshold: 0.42,
      maximumQueryCharacters: 2_000,
    });
  });

  it("rejects an impossible default top-k", () => {
    expect(() =>
      getRetrieverConfig({
        RETRIEVAL_DEFAULT_TOP_K: "20",
        RETRIEVAL_MAX_TOP_K: "10",
      }),
    ).toThrow("RETRIEVAL_DEFAULT_TOP_K must not exceed RETRIEVAL_MAX_TOP_K");
  });

  it.each(["-0.1", "1.1", "not-a-number"])(
    "rejects invalid similarity threshold %s",
    (value) => {
      expect(() =>
        getRetrieverConfig({ RETRIEVAL_SIMILARITY_THRESHOLD: value }),
      ).toThrow("RETRIEVAL_SIMILARITY_THRESHOLD must be a number between 0 and 1");
    },
  );
});
