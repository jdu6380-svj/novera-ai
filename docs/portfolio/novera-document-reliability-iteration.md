# Novera 文档解析可靠性迭代

## 项目与用户任务

Novera AI 面向企业知识检索与问答场景。用户上传经营资料、会议纪要和业务文档后，希望得到可追溯的答案、来源和证据。对这类产品来说，解析失败并不只是技术错误：如果扫描页被当成完整成功，后续检索和回答可能会建立在缺失内容上。

本案例记录一次范围受控的可靠性迭代。目标不是一次性做完整的多格式平台，而是先把“解析不完整却被当成成功”的边界识别清楚，并用一套可复现的合成语料验证行为。

## 问题发现

固定基线的 PDF 解析器会把每页文本交给 `plainTextBlocks`，但修改前没有记录“某页没有可提取文本”的状态。整份扫描 PDF 最终会因为没有内容而失败，但错误信息只说明文档为空，没有明确告诉用户需要 OCR 或人工复核。混合文本和扫描页的 PDF 则可能返回可读页内容，却缺少不完整提示。

这会影响两个用户任务：

1. 用户无法判断回答覆盖的是整份文档还是只覆盖可读页面。
2. 运营人员无法把扫描页放入 OCR 或人工复核队列。

本次优先处理解析边界，而不是先开发 OCR、Excel 或 PPTX 解析。原因是边界误标记会污染后续 RAG，而明确记录复核需求可以为后续治理提供信号。备选方案包括现在接入 OCR、直接扩展更多格式、或只改上传提示。OCR 和多格式扩展的依赖及验证成本更大，因此本轮选择最小的解析层改进。它尚未解决 Workspace 中的用户可见提示。

## 方案与实现

实际修改集中在 PDF 解析器和回归测试：

- `src/features/knowledge-processing/content/parser.ts`
  - 对每个 PDF 页面检查是否存在可提取文本。
  - 混合文本/扫描 PDF 返回可读内容，同时写入 `PAGE_HAS_NO_EXTRACTABLE_TEXT`、页码和 `review_required` 元数据。
  - 整份无可提取文本的 PDF 抛出 `EMPTY_DOCUMENT`，并提示使用 OCR 或重新上传文本型 PDF。
- `src/features/knowledge-processing/content/parser.test.ts`
  - 增加混合扫描页的回归断言，验证可读块保留和页级告警。

这次没有添加 OCR、图片识别、Excel/PPTX 解析器，也没有修改模型、Embedding、Supabase 或数据库路径。

## 受控测试语料

语料位于 `evals/document-reliability/`，所有组织、数字和文档均为合成数据，不代表真实企业年报。

| 格式 | 数量 | 本轮结果 |
| --- | ---: | --- |
| PDF | 5 | 3 PASS，2 PARTIAL（混合扫描、纯扫描） |
| DOCX | 4 | 4 PASS |
| Markdown | 3 | 3 PASS |
| TXT | 3 | 3 PASS |
| XLSX | 2 | 2 UNSUPPORTED |
| PPTX | 2 | 2 UNSUPPORTED |
| PNG | 1 | 1 UNSUPPORTED |
| 合计 | 20 | 13 PASS，2 PARTIAL，5 UNSUPPORTED |

每份文档包含唯一 `document_id`、文件哈希、格式、预期能力、实际状态和限制。共设计 40 个问题，覆盖单文档事实、数值和单位、跨文档比较、列表、知识缺口、扫描边界、表格、幻灯片和图像边界。标准答案和证据位置保存在 `corpus-spec.v1.json`，执行结果保存在 `actual-results.v1.json`。

## 修改前后行为

修改前的 HEAD 代码没有 PDF 页级提取告警。混合扫描页会保留已读文本，但无法向上层标示缺失页面；整份扫描 PDF 只会走通用空文档错误。

修改后，同一份本地语料得到：

- 13 份文档 `PASS`。
- 2 份 PDF `PARTIAL`，分别包含页级复核告警或 `EMPTY_DOCUMENT`/OCR 提示。
- 5 份当前解析器不支持的格式 `UNSUPPORTED`，在进入检索前被拒绝。
- 40 个问题全部在 `local_parser_only` 模式下执行证据检查，但没有执行 Retriever、Embedding、生成模型或远端 API。
- 26 个问题存在解析证据，但状态明确为 `PARSER_EVIDENCE_PRESENT_RAG_NOT_EXECUTED`。
- 4 个问题需要 OCR 或人工复核，状态为 `REVIEW_REQUIRED_RAG_NOT_EXECUTED`。
- 10 个问题属于不支持格式，状态为 `UNSUPPORTED_RAG_NOT_EXECUTED`。

因此，这些结果证明了“证据字符串是否被解析器保留”和“解析边界是否被标记”，不证明真实 RAG 已回答正确，也不证明真实年报效果。评测没有核验检索排序、答案正确性或引用位置与原文定位的一致性。当前结果中没有任何问题被描述为线上模型通过。

## 验证与证据

聚焦回归命令：

```bash
npm test -- src/features/knowledge-processing/content/parser.test.ts evals/document-reliability/corpus-eval.test.ts src/features/knowledge-processing/application/document-processing-service.test.ts
```

结果：3 个测试文件通过，9 个测试通过。此前基线的解析/处理服务聚焦测试为 7 项通过；本轮新增 PDF 边界回归后为 9 项。没有重跑完整 TypeScript、Lint、端到端浏览器或线上测试。

XLSX 与 PPTX 样本由本地 bundled `@oai/artifact-tool` 生成，并在 `/private/tmp/novera-document-reliability-qa/` 进行渲染检查。渲染结果可读，但这只证明测试文件本身有效，不改变应用解析器对这些格式的 `UNSUPPORTED` 结论。

告警元数据会由 Normalizer 包装并进入处理结果的 `normalizedMetadata`。本次代码检查没有找到 Workspace 显式读取或呈现 `extractionWarnings` 的路径。处理服务仍会继续处理剩余文本，并可能把混合扫描 PDF 标成 `READY`。因此本轮验证的是 parser 能检测并记录边界，不是 UI 已通知用户，也不是下游问答已屏蔽不完整文档。

## 失败兜底策略

- 混合扫描 PDF：保留可读页，显式标记需要复核的页码，不把整份文件标成完整成功。
- 纯扫描 PDF：返回 `EMPTY_DOCUMENT`，提示 OCR 或重新上传文本型 PDF。
- 不支持格式：在解析层拒绝，后续产品应提示导出为 PDF、DOCX、Markdown 或 TXT。
- 证据不足：本轮语料保留知识缺口问题，但未执行生成模型拒答；不能把静态证据检查当作拒答通过。

## 未完成事项与下一步

本轮仍未完成 OCR、手写识别、图像/图表理解、XLSX/PPTX 解析、真实 Embedding、真实 Retriever、模型回答、引用验证和线上费用/性能验证。若继续投入，优先顺序应是：先为 OCR 和表格/幻灯片解析定义可验证的输出契约，再用同一语料接入离线 Retriever/Embedding 评测，最后才进行受控的真实模型验收。

## 结论

本次迭代完成了 parser 层的检测与离线回归闭环：代码能识别无文本页、记录复核告警，并对纯扫描 PDF 返回 OCR 提示。应用层 READY 状态和用户可见告警仍未闭环。由于真实 RAG、OCR 和多格式解析尚未验证，案例状态应记录为 `PARTIAL`，不能写成准确率提升或完整多格式能力已交付。

## 2026-10-23 追加：告警到准入闭环

后续实现补上了最小的产品安全闭环：只要 parser 返回必须复核的内容，处理服务就在 chunk/embedding 前失败；错误消息保留页码、缺失说明和对应补救。Workspace 将失败或历史 metadata 中带告警的旧 `ready` 文档显示为“需要复核/无法问答”，并从 ready 指标中排除。Retriever 还会过滤历史 `ready` 记录中带 `review_required` 的 chunk，防止只隐藏 UI、检索仍可取回的情况。

DOCX 表格结构尚未完整解析，因此现在会显式标记表格行列关系未保留并阻止问答；图片/嵌入对象同样触发复核。DOCX 可读段落、Markdown、TXT 和原生 PDF 的 parser smoke 结果不能代表所有结构语义都已支持。

本次本地验证：6 个聚焦测试文件、26 项测试通过；`typecheck`、`lint`、`git diff --check` 通过。语料含 20 个文件和 40 个 case，hash/ID 检查通过。parser 层结果为 12 PASS、3 PARTIAL、5 UNSUPPORTED；40 个问题中 24 个只达到 parser evidence present、6 个需要复核、10 个格式未支持（以 `evals/document-reliability/actual-results.v1.json` 为准）。这些数字不是 RAG accuracy，也不包含任何真实检索/模型调用。

完整 RAG、Embedding、Supabase、OCR/手写识别以及 XLSX/PPTX/图片解析仍未完成；真实业务 API 未调用。`npm run build` 因当前沙箱对 Turbopack 创建子进程/绑定端口的限制未能完成。案例仍是 `PARTIAL`，不可对外描述为 20/20 文档与 40/40 问答已通过。

## 2026-10-24 追加：独立 v2 标准下的真实 RAG 复验

后续迭代保留上述 v1 案例与历史记录，另建 `acceptance.v2.json`，把 20 份文档 profile 和 40 个原始 case 逐项映射到可核验的解析、检索、来源定位、Evidence、回答或拒答标准。v1 语料、Ground Truth、阈值和原始运行文件均保持原样。v2 将多格式解析能力纳入真实执行，同时把低置信 OCR 与未验证图表内容设为不可采信证据。

在固定合成语料的最终 v2 运行中，20/20 文档通过各自 profile，40/40 问题真实完成向量检索并通过对应标准。文档处理实际产生 40 个 chunks，29 个满足准入的 chunks 使用 DashScope `text-embedding-v2` 嵌入并写入进程内本地索引；40 个问题触发真实查询嵌入和本地余弦检索。35 个问题调用 DeepSeek `deepseek-flash` 生成，另 5 个低置信图片 OCR 问题在生成前安全拒答。35 个生成回答通过 Evidence 校验；全量结果没有 invalid citation 或 unsupported claim。

这个 PASS 限定于验收标准 `2.0.0`、固定合成数据集和本地进程内向量索引，不等于 v1 原评测改为 PASS，不证明任意企业文档或图表视觉理解，也不代表 Production/Supabase 验收或用户测试。5 份文档的解析状态仍是 PARTIAL；它们通过的是安全隔离与限制问答的 profile，而不是“全部内容已完整识别”。

可复核的映射、完整逐题结果、模型请求量与费用估算见 [v2 终验报告](../document-reliability-v2-final-2026-10-24.md) 和 [独立 v2 验收配置](../../evals/document-reliability/acceptance.v2.json)。

