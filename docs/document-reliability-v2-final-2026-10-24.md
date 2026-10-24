# Novera AI 文档可靠性与真实 RAG v2 终验

## 结论

**PASS（仅适用于独立验收标准 v2.0.0 和本次固定合成语料）**。本轮最终运行对 20 份文档逐份执行了解析、分块、准入判断、Embedding 和本地索引处理；40 个原始问题均完成真实 Query Embedding、检索和 v2 评分，40/40 达到各自明确映射的 v2 标准。

此结论不覆盖生产部署、Production Supabase、真实企业资料或真实用户测试，也不表示所有文件内容均能无损解析。v1 的原始验收配置、语料、Ground Truth、旧运行记录和 PARTIAL 结论保持原样；v2 是独立、版本化的验收口径，没有把历史 v1 失败拼接成 v2 通过。

## 标准与原始用例映射

权威配置为 [`acceptance.v2.json`](../evals/document-reliability/acceptance.v2.json)，版本 `2.0.0`，SHA-256：`06daf0c82ff478c8dcc63644a6e69f8e2a9ec208de62f9be1803ef8d3e2a3482`。配置逐一列出 `doc-001` 至 `doc-020` 的验收 profile，以及 `case-001` 至 `case-040` 对应的原始 `document_id`、v1 answerability、v2 standard、证据模式、来源定位和逐题接受形式。20 个 document ID 与 40 个 case ID 均唯一，每个原始 case 恰好映射一次。

| v2 标准 | 原始 case |
| --- | --- |
| `grounded_answer` | 001–005、007、011–013、015–017、019–023、025、027–030 |
| `information_gap_refusal` | 008、018、024、026 |
| `review_required_ocr_refusal` | 006、009、010、039、040 |
| `docx_structured_row_answer` | 014 |
| `xlsx_structured_row_answer` | 031–034 |
| `pptx_slide_text_answer` | 035–038 |

20 个文档 profile 和全部 case 的完整映射以 JSON 为准。22 个 case 明确记录了映射说明：仅接受数值、单位或表述等价且保留原事实的答案形式；修正已核实的来源行号；对新实现的表格/幻灯片文本要求结构化来源和准确位置；对低置信 OCR 要求排除风险内容并拒答。没有修改 `corpus-spec.v1.json` 中的原始答案、证据或固定阈值。v2 不是对旧评测实现的静默放宽：回答仍须满足来源、位置、Evidence 和安全边界要求；OCR 拒答也只在禁止来源未进入答案证据且没有无效引用/无依据声明时通过。

## 本轮真实执行

最终运行记录：[`2026-10-23T18-30-30-016Z-full-v2.json`](../evals/document-reliability/runs/2026-10-23T18-30-30-016Z-full-v2.json)。运行使用 HEAD `d5c41304a5e223ecd1d67f598d0e0bc1c2e144e1`；记录中的 17 个实现文件 SHA-256 指纹与当前工作区逐一吻合。

| 项目 | 实际结果 |
| --- | --- |
| 文档 | 20/20 通过各自 v2 profile；15 份完整解析、5 份部分解析 |
| 解析与分块 | 实际解析 40 个 chunks；29 个符合问答准入并真实完成 Embedding、进入进程内本地向量索引；其余 11 个受告警/复核边界限制 |
| 文档 Embedding | DashScope `text-embedding-v2`，1536 维；2 次请求上限，服务报告 1,124 tokens |
| 查询向量 | 40/40 问题完成真实 Query Embedding 与本地余弦向量检索；40 次请求、52 个向量（含查询扩展）；服务报告 406 tokens |
| 生成 | DeepSeek `deepseek-flash`；35 次真实生成，35 次有可解析结果；5 个低置信 OCR 用例在生成前安全拒答 |
| v2 评分 | 40/40 PASS；40/40 检索已执行；40/40 来源/边界位置检查通过 |
| Evidence | 35 个生成回答均有有效 Evidence；全体 40 个用例累计 0 条 invalid citation、0 条 unsupported claim。5 个安全拒答没有伪造为有引用回答，其无生成 Evidence 的情况按 OCR 拒答规则单独验收 |
| 存储边界 | 仅进程内 `LocalVectorIndex` 和本地运行 JSON；未调用 Supabase/pgvector、Storage 或业务数据库/API |

本轮调用量和成本估算来自运行记录。按供应商返回的 token 数和公开列表/高峰价格估算：DashScope 约 `¥0.001071`，DeepSeek 约 `$0.018627`。这是估算值，不是账户账单；未读取供应商账户用量或账单。

## 多格式边界

- PDF、DOCX、Markdown、TXT、XLSX、PPTX 和 PNG 均有真实解析记录；XLSX 行保留表头/值关联与工作表行定位，DOCX 表格用例保留行列关系，PPTX 用例验证的是非图表文本块与幻灯片定位。
- 图表缓存数据不作为已验证图表理解能力；图表视觉内容、复杂图形语义和图表数值解释未通过本轮验证。
- 5 份部分解析文档仍按各自 v2 profile 通过，是因为可用内容被明确隔离/限制，或复核内容没有进入问答证据；不能把它们描述为完整解析。
- `case-039`、`case-040` 的图片 OCR 达不到安全阈值，正确行为是拒答并提示 OCR/人工核对；这证明了低置信内容的兜底，不证明手写字符识别准确。
- 语料是固定合成数据，不代表真实企业年报的泛化质量。

## v1 完整性与历史

以下既有 v1 文件在本次核验时与 v2 配置所登记的哈希完全一致：

- Manifest：`ab1b8325408a0fa0fd8490b04fd0aaaf8d9a62e7170a3b2f5ecd5527441d9f06`
- Corpus spec / Ground Truth：`7443bd05600f32514632016027fbfd325b14b58e2964d6a43013797daed0d861`
- Actual results：`e0708c251f20e5de91c609845f1b044487b7744d04a104d025a4cbaff2c6cdc8`
- 原始 v1 full run：`d48fead962fd48817c9f0cd4c4d5f4a17431a97bce4811b6017b2da25191dd30`

原始 v1 的 12 PASS / 11 FAIL / 17 UNVERIFIED 保留为历史结果，不因 v2 通过而改写。需要引用成绩时应同时说明验收版本与数据边界。

## 工程验证与操作边界

本轮之前已完成的验证记录为：Vitest 237 passed、1 skipped；TypeScript、完整 ESLint、`git diff --check` 和 Next.js production build 通过。这里不重复运行这些已通过检查。固定语料和 v1 文件哈希未变；没有部署、提交或推送，也没有修改远端 Supabase/Production。

## 可复核文件

- v2 规则与逐项映射：[`evals/document-reliability/acceptance.v2.json`](../evals/document-reliability/acceptance.v2.json)
- v2 规则测试：[`evals/document-reliability/acceptance.v2.test.ts`](../evals/document-reliability/acceptance.v2.test.ts)
- v2 评分实现与测试：[`scoring.v2.ts`](../evals/document-reliability/scoring.v2.ts)、[`scoring.v2.test.ts`](../evals/document-reliability/scoring.v2.test.ts)
- 完整逐文档/逐问题真实结果：[`2026-10-23T18-30-30-016Z-full-v2.json`](../evals/document-reliability/runs/2026-10-23T18-30-30-016Z-full-v2.json)
- v1 基线报告（历史）：[`document-reliability-real-rag-2026-10-24.md`](document-reliability-real-rag-2026-10-24.md)
