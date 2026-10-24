#!/usr/bin/env python3
"""Synchronize case metadata after a controlled fixture-content change."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = json.loads((ROOT / "corpus-spec.v1.json").read_text(encoding="utf-8"))
manifest_path = ROOT / "manifest.v1.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
cases = {case["case_id"]: case for document in spec["documents"] for case in document["questions"]}
for item in manifest["cases"]:
    source = cases[item["case_id"]]
    item["question"] = source["question"]
    item["question_type"] = source["question_type"]
    item["expected_answer"] = source["expected_answer"]
    item["evidence_text"] = source["evidence"]
    item["evidence_location"] = [evidence["evidence_location"] for evidence in source["evidence"]]
    item["answerability"] = source["answerability"]
    item["expected_behavior"] = source["expected_behavior"]
    if source.get("related_document_ids"):
        item["related_document_ids"] = source["related_document_ids"]
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Synchronized manifest case evidence from the corpus specification.")
