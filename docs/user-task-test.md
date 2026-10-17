# Novera AI User Task Test

## Purpose

Validate whether 3–5 product or operations participants can complete the narrow RAG workflow without coaching. Do not record names, customer data, or confidential documents. Use the fictional Asteria Workcloud corpus only.

## Participant gate

- Target: 3–5 participants working in Product, Product Operations, Customer Operations, or Support Operations.
- A session is valid only when the participant operates the deployed live RAG build and the facilitator records the deployment URL and date.
- Demo fallback mode, facilitator-completed runs, and synthetic personas do not count as participant results.

## Tasks

| ID | Task | Success evidence | Target |
|---|---|---|---|
| T1 | Upload one Markdown source and wait for READY. | Participant identifies processing state and READY without prompting. | 100% completion |
| T2 | Ask what changed in Q2 activation. | Participant reaches a structured answer and identifies Task Understanding. | ≥80% completion |
| T3 | Inspect one claim and locate the exact source passage. | Participant opens Evidence and states the document plus line/section locator. | ≥80% completion |
| T4 | Ask the unsupported ARR question. | Participant recognizes the refusal as intentional and does not treat it as an error. | 100% correct interpretation |
| T5 | Explain one quality score and one knowledge gap. | Participant can distinguish retrieval quality from evidence coverage. | ≥80% completion |

## Session script

1. Confirm the header says `实时知识库`; stop if it says `演示数据模式`.
2. Give the participant the five tasks above without explaining navigation.
3. Record task completion, time, errors, confidence (1–5), and one verbatim observation.
4. Ask: “Which signal made you trust or distrust the answer?”
5. Ask: “What would you change before using this for a real product decision?”

## Results log

| Participant | Role | Date | Build URL | T1 | T2 | T3 | T4 | T5 | Critical issue | Verbatim observation |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 |  |  |  |  |  |  |  |  |  |  |
| P2 |  |  |  |  |  |  |  |  |  |  |
| P3 |  |  |  |  |  |  |  |  |  |  |
| P4 |  |  |  |  |  |  |  |  |  |  |
| P5 |  |  |  |  |  |  |  |  |  |  |

Use `pass`, `fail`, or `blocked` for each task. A blank row is not a completed test.

## Iteration decision

After at least three valid sessions, group issues by frequency and impact. Implement one bounded iteration against the highest-impact repeated issue, then rerun the affected task with at least two participants. Record the before/after completion rate and link the changed files or deployment.
