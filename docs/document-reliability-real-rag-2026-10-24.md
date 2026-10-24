# Novera AI 真实 RAG 全量验收报告

## 结论

**PARTIAL**。本轮真实处理了固定 20 份文档，并对 40 道问题完成了真实 Query Embedding 与本地向量检索。12 道问题按固定评测规则通过，11 道未通过，17 道因生成错误无法验证。所有 20 份文档均有实际解析记录；其中 15 份完整解析、5 份部分解析。

本报告仅使用本轮全量运行记录，不把 Smoke Test、预检、Mock 或历史结果计入成绩。

## 运行边界与身份

- 本轮运行记录：[2026-10-23T16-15-05-495Z-full.json](../evals/document-reliability/runs/2026-10-23T16-15-05-495Z-full.json)
- 固定语料：20 份文档、40 道问题；运行时逐一核对 fixture 与 manifest 哈希。
- Manifest SHA-256：`ab1b8325408a0fa0fd8490b04fd0aaaf8d9a62e7170a3b2f5ecd5527441d9f06`
- Corpus spec SHA-256：`7443bd05600f32514632016027fbfd325b14b58e2964d6a43013797daed0d861`
- Embedding：DashScope `text-embedding-v2`，1536 维。
- 生成：DeepSeek `deepseek-flash`。
- 索引和检索：本进程内 `LocalVectorIndex`，余弦相似度；没有调用 Supabase/pgvector，也没有写入数据库或 Storage。
- 全程 SDK 自动重试为 0；没有部署、提交或推送。

## 文档处理

本轮实际解析出 40 个 chunks，其中 29 个通过问答准入并完成 Embedding、写入本地内存索引；11 个因来源告警被排除。下表为本轮实际结果，格式为“解析 chunks / 可问答并已索引 chunks”。

| ID | 格式 | 状态 | Chunks | 备注 |
|---|---|---:|---:|---|
| doc-001 | PDF | PASS | 2 / 2 |  |
| doc-002 | PDF | PASS | 1 / 1 |  |
| doc-003 | PDF | PARTIAL | 3 / 2 | 第 2 页 OCR 平均置信度 72%，含手写内容；需人工核对 |
| doc-004 | PDF | PASS | 1 / 1 |  |
| doc-005 | PDF | PARTIAL | 1 / 0 | 扫描页 OCR 需人工核对；未进入问答索引 |
| doc-006 | DOCX | PASS | 1 / 1 |  |
| doc-007 | DOCX | PASS | 2 / 2 |  |
| doc-008 | DOCX | PASS | 1 / 1 |  |
| doc-009 | DOCX | PASS | 1 / 1 |  |
| doc-010 | Markdown | PASS | 3 / 3 |  |
| doc-011 | Markdown | PASS | 1 / 1 |  |
| doc-012 | Markdown | PASS | 3 / 3 |  |
| doc-013 | TXT | PASS | 1 / 1 |  |
| doc-014 | TXT | PASS | 1 / 1 |  |
| doc-015 | TXT | PASS | 1 / 1 |  |
| doc-016 | XLSX | PASS | 2 / 2 | 有合并单元格告警 |
| doc-017 | XLSX | PASS | 2 / 2 | 有合并单元格告警 |
| doc-018 | PPTX | PARTIAL | 6 / 2 | 两页使用图表缓存；图表标签和单位需核实 |
| doc-019 | PPTX | PARTIAL | 6 / 2 | 两页使用图表缓存；图表标签和单位需核实 |
| doc-020 | PNG | PARTIAL | 1 / 0 | OCR 平均置信度 88%、最低词置信度 20%；未进入问答索引 |

## 问题与检索结果

40/40 问题完成 Query Embedding 和实际检索；生成尝试 40 次，23 次返回并通过结构解析，17 次失败。详细的每题 Query、实际命中 chunks 与来源定位、模型回答、Evidence、Ground Truth 对照、耗时和错误均保存在本轮 JSON 的 `cases[]` 中。

| 评测状态 | 数量 | Case IDs |
|---|---:|---|
| PASS | 12 | case-005, case-007, case-015, case-016, case-017, case-019, case-022, case-023, case-027, case-028, case-029, case-038 |
| FAIL | 11 | case-003, case-008, case-012, case-018, case-024, case-025, case-026, case-032, case-033, case-035, case-039 |
| UNVERIFIED | 17 | case-001, case-002, case-004, case-006, case-009, case-010, case-011, case-013, case-014, case-020, case-021, case-030, case-031, case-034, case-036, case-037, case-040 |

评测口径保持原样：答案需包含归一化后的预期答案文本、检索结果需覆盖全部预期 Evidence 文本，且 Evidence 校验有效。检索 Evidence 覆盖为 15/40（37.5%）：此项表示“所有预期 Evidence 文本均出现在返回结果中”，不是传统排序指标或语义召回率。答案字符串包含检查为 17/40（42.5%），不等同于人工语义正确率。

本轮 23 个可解析回答共包含 39 条有效 Evidence；无 invalid evidence、无 unsupported claims。5 个回答将 `insufficientEvidence` 设为 true（case-003、008、018、024、026）。固定 runner 只对 `requires_ocr_or_review` 明确计算拒答正确性；因此 `unanswerable` 用例中的拒答仍按原 runner 规则判定，未在本报告中改写标准或人工计为 PASS。

原始运行 JSON 中 `aggregate.failed=28` 与 `not_verified=17` 有重叠：runner 将执行状态 `FAILED` 与评测状态 `FAIL` 合并计入 failed，又单独计入 UNVERIFIED。上表按每题唯一的 `evaluation.status` 互斥重算为 12 PASS、11 FAIL、17 UNVERIFIED，合计 40；原始运行记录未被修改。

## 指定格式用例

- PPTX：case-035 命中 doc-018 第 1 页，答案包含 85%，Evidence 有效，但固定 expected-evidence 覆盖检查未通过；case-036、case-037 生成失败，未完成答案/Evidence 验证；case-038 命中 doc-019 第 2 页并通过。
- 图片 OCR：doc-020 产生低置信度告警，唯一 chunk 被排除。case-039 虽生成了 99.1% 的回答，但命中来源为 DOCX doc-006 而非目标 PNG，固定 Evidence 检查失败；case-040 检索到其他文档后生成请求返回错误，评测为 UNVERIFIED。没有将跨文档相似内容冒充图片 OCR 成功。

## 请求量与费用

- DashScope 文档 Embedding：29 个 chunks，按批次上限计算 2 次请求；Query Embedding：40 次。服务报告 token 分别为 1,124 与 364。
- DeepSeek：40 次生成尝试；23 个回答成功返回并解析，17 个失败。16 个错误为 `INVALID_PROVIDER_RESPONSE`，1 个为 `PROVIDER_REQUEST_FAILED`；原始消息、响应头及凭据均未保存，失败项 HTTP 状态未记录。
- 按成功响应可取得的 token 计算，DashScope 估算 ¥0.0010416，DeepSeek 估算 $0.0151383。两者均为按公开列表/高峰价格计算的估算，不是账户实际账单；17 次失败请求可能仍产生用量，其 token/费用未知。
- 本轮预检费用上限为 DashScope ¥0.001254、DeepSeek $0.072576。未读取供应商账户账单。

## 回归与构建

- 相关回归：10 个测试文件，51 tests passed。
- TypeScript：通过。
- ESLint：通过。
- Next.js production build：通过。

## 最终状态与剩余事项

整体为 **PARTIAL**，不能宣称 20/20 完整解析或 40/40 RAG 通过。完成剩余工作至少需要：

1. 诊断 DeepSeek 的 16 个无效结构响应与 1 个请求失败；当前按零重试保留失败，不重放调用。
2. 修复检索/证据对齐问题，重点处理 case-012、025、032、033、035、039 的预期证据未命中或来源不匹配。
3. 为 doc-005 与 doc-020 提供达到固定门槛的 OCR/人工核验内容；维持其未核验内容不进入索引。
4. 单独修正拒答评分对 `unanswerable` 的处理后，基于本轮已保存结果离线复算；不得改变 Ground Truth 或阈值。
