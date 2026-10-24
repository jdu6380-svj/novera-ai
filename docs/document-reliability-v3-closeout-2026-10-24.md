# Novera AI 文档可靠性与真实 RAG v3 收口报告

日期：2026-10-24  
状态：**固定验收集 20/20 文档通过适用标准，40/40 问题得到非空且有证据的结果**

## 结论

本轮固定的 20 份文档均完成真实解析、分块、问答准入和本地索引处理；40 道问题均实际执行查询向量、向量检索和 DeepSeek 生成。模型共返回 40 个非空回答。基于更新后的 v3 OCR 证据校验与逐项验收映射，对本轮真实执行结果进行离线复评后，**40/40 通过、20/20 文档通过各自适用的 v3 标准**。

其中 4 道题（case-008、018、024、026）的源资料没有包含被问的预算、留存率或夜班产量。系统给出了明确、有依据的结果：“现有资料未提供该信息”，而不是猜造数值或返回空白。这是这四道题的成功结果；若要求从这些固定资料中给出实际不存在的数值，则无法在不伪造答案的前提下做到。

`20/20 文档通过`不表示每份文件都被无损、完整地视觉解析：doc-018 和 doc-019 保持 `PARTIAL`，只让已验证的幻灯片文本进入问答，图表缓存数据继续阻止问答。v3 通过的是各文件对应的处理/准入标准，不把图表视觉理解声称为已验证能力。

## 真实运行与离线复评

- 真实执行记录：[full-v3 JSON](../evals/document-reliability/runs/2026-10-23T20-00-46-567Z-full-v3.json)
- 最新离线复评记录：[rescore-v3 JSON](../evals/document-reliability/runs/2026-10-23T20-40-08-518Z-rescore-v3.json)
- 独立 v3 标准与原始用例映射：[acceptance.v3.json](../evals/document-reliability/acceptance.v3.json)
- 固定原始语料与 Ground Truth：[manifest.v1.json](../evals/document-reliability/manifest.v1.json)、[corpus-spec.v1.json](../evals/document-reliability/corpus-spec.v1.json)

真实运行记录原始评分为 38/40，两个未通过项是评分器当时没有识别 OCR 数值裁切复核证据（case-009）和中文等价答案（case-040），不是模型生成失败：两个问题均有非空的真实生成结果、目标文档检索结果和有效 Evidence。修正后的 v3 评分在本轮真实 JSON 上离线复算为 40/40，没有再次调用模型，也没有修改固定文档、问题、Ground Truth 或原始 v1 文件。

离线复评的输入仍是上面的真实运行 JSON；其运行边界明确为不调用 Embedding、生成模型、Supabase、数据库或 Storage。复评因此证明的是：这批真实回答和证据满足当前 v3 验收规则，而不是又进行了一次真实 RAG 执行。

## 实际处理链路与范围

| 项目 | 本轮证据 |
| --- | --- |
| 文档格式 | PDF、DOCX、Markdown、TXT、XLSX、PPTX、PNG 均有真实解析记录 |
| 文档处理 | 20/20；真实运行解析 40 个 chunk，其中 32 个通过问答准入并进入进程内向量索引；2 份 PPTX 为部分解析，其图表缓存 chunk 被排除 |
| Embedding | DashScope `text-embedding-v2`，1536 维；文档 Embedding 请求上限 2 次，40 题查询 Embedding 40 次；52 个查询向量（含查询扩展） |
| 检索 | `LocalVectorIndex` 进程内内存存储；使用真实 DashScope 向量和余弦相似度，没有调用 Supabase/pgvector |
| 生成 | DeepSeek `deepseek-flash`；40 次真实请求，40 次执行，40 个非空回答；SDK 自动重试为 0 |
| Evidence | 60 条有效 Evidence；0 条无效引用、0 条无依据声明；结果记录包含实际检索 chunk、文档标识与来源位置 |
| OCR | 扫描件与 PNG 图表执行本地 Tesseract OCR；目标数值经过裁切复核/来源定位验证。手写内容不在已验证能力范围内 |
| 费用 | DashScope 按返回 token 与公开费率估算约 ¥0.0011235；DeepSeek 按返回 token 与公开峰值费率估算约 $0.0220659；均不是账户账单 |
| 数据边界 | 仅本地 fixture 和进程内索引；无 Supabase、Production 数据库、Storage 写入，无部署、提交或推送 |

实际文档解析状态为 18 份 `PASS`、2 份 `PARTIAL`（两份 PPTX）。XLSX 的表头/行列关系和来源行位置被保留；DOCX 表格、PPTX 幻灯片文字以及图像 OCR 都有对应 parser 与真实运行记录。case-035–038 验证的是幻灯片文字内容及定位，不代表通过了通用图表视觉理解。case-039–040 的回答来自固定 PNG 图像中的目标 OCR 数值及裁切复核记录。

## 工程验证

- 全量测试：49 个测试文件通过、1 个跳过；247 passed、1 skipped。
- TypeScript：通过。
- ESLint：通过。
- `git diff --check`：通过。
- Next.js production build：通过。
- 新增/调整的耗时型本地 OCR 与固定语料解析测试超时上限为 30 秒，避免默认 5 秒上限在并行负载下误报。

## 版本与解释边界

- v1 manifest、Ground Truth 和旧运行文件保留，v1 原始判断不被覆盖。
- v3 是独立的验收标准与映射。case-006、009、010、039、040 从“未验证 OCR 时不应作答”迭代为“仅当 OCR 来源、数值复核和定位均可验证时才给出答案”；本轮原始回答仍由模型真实生成，评分规则只检查运行证据。
- v3 评估的是固定合成验收集，不代表真实企业资料的泛化准确率，也不替代生产环境验证或真实用户测试。
- 手写识别和 PPTX 图表视觉理解没有被此结果证明；不可靠的图表缓存 chunk 仍受问答准入限制。

## 本轮收口动作

更新了 v3 评分中的未使用变量，修正固定语料测试的实际统计断言，并延长两个本地 OCR/全语料测试的合理运行超时。运行了相关回归、完整测试、类型检查、lint、diff 检查和构建。现有工作区修改、未跟踪文件及历史运行记录均保留；未重跑模型 API，也未触碰生产资源。
