# Retrieval Evaluation

Phase 3 keeps retrieval quality auditable through a versioned Golden Dataset.

Files:

- `golden-dataset.v1.json`: questions plus expected source documents and chunks.
- `deterministic-results.v1.json`: stable evaluator fixture used by CI/unit tests.
- `evaluator.ts`: Hit Rate@K, Recall@K, MRR, document recall, and chunk recall.

Run the deterministic evaluator:

```bash
npm run eval:retrieval
```

The full working repository also contains a live retrieval evaluator that calls
`POST /api/v1/retrieval/query` against a configured deployment. That internal
tool is intentionally excluded from the first public file set, so it cannot be
run from this public checkout. The deterministic result file validates metric
behavior against fixtures; it is not a substitute for a staging run or live
retrieval performance.
