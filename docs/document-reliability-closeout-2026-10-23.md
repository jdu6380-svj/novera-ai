# Novera 文档解析可靠性迭代收口报告

**状态：PARTIAL**

> 本报告最初记录了 parser-only 阶段。2026-10-23 的后续闭环结果见文末“追加闭环”；追加内容为当前结论。

## 实际完成

- 在 PDF 解析器中增加混合文本/扫描页告警：`PAGE_HAS_NO_EXTRACTABLE_TEXT`。
- 对整份无可提取文本的 PDF 返回 `EMPTY_DOCUMENT`，提示 OCR 或重新上传文本型 PDF。
- 增加 PDF 边界回归测试。
- 建立 20 份合成测试文档：PDF 5、DOCX 4、Markdown 3、TXT 3、XLSX 2、PPTX 2、PNG 1。
- 建立 40 个带标准答案、原文证据和位置的问题。
- 生成并核验 `evals/document-reliability/manifest.v1.json` 与 `actual-results.v1.json`。
- 记录作品集案例：`docs/portfolio/novera-document-reliability-iteration.md`。

## 本轮验证

命令：

```bash
npm test -- src/features/knowledge-processing/content/parser.test.ts evals/document-reliability/corpus-eval.test.ts src/features/knowledge-processing/application/document-processing-service.test.ts
```

结果：3 个测试文件通过，9 个测试通过。

文档结果：13 PASS、2 PARTIAL、5 UNSUPPORTED。

问题结果：26 条 `PARSER_EVIDENCE_PRESENT_RAG_NOT_EXECUTED`、4 条 `REVIEW_REQUIRED_RAG_NOT_EXECUTED`、10 条 `UNSUPPORTED_RAG_NOT_EXECUTED`。40 条问题均没有执行 Retriever、Embedding、生成模型或远端 API。

XLSX 2 份和 PPTX 4 张幻灯片已做本地渲染检查，版面和文字可读。渲染检查不等于应用已经支持这些格式。

## 前后对照

固定 HEAD 的原始 PDF 代码只调用通用文本块解析和空文档断言，没有页级空文本告警。当前代码保留可读页，并在混合扫描文件中返回复核元数据；纯扫描文件返回带 OCR 提示的 `EMPTY_DOCUMENT`。这是源码行为对照，不是同一语料的修改前实测对照。聚焦测试由此前 7 项扩展到当前 9 项，其中新增 PDF 边界回归和 20 文档语料评估各 1 项。

解析告警会进入处理元数据，但当前没有发现 Workspace 前端显式展示该告警的代码路径；混合扫描文档仍可能继续处理并达到 `READY`。因此应用层的用户提示和避免不完整文档参与问答仍未验证，也不应宣称已经修复。

## 未完成与边界

- 未实现 OCR 或手写字符识别。
- 未实现 XLSX、PPTX、PNG/JPG 的应用解析链路。
- 语料评测只检查证据字符串是否出现在解析结果中，不验证检索排序、模型答案正确性或引用位置与原文定位的一致性。
- 未执行真实 RAG 检索、Embedding、生成模型、Supabase、数据库或线上 API。
- 未验证真实企业年报、真实用户效果、线上准确率、费用或性能。
- 合成语料只用于受控解析边界测试，不能代表真实企业数据表现。

## 产品结论

本轮证明了 parser 能对 PDF 的可提取内容和扫描边界做不同处理，并在元数据/错误消息中记录复核要求。由于告警尚未确认对用户可见、文档仍可能达到 `READY`，且 RAG 和未支持格式仍未验证，不能将本轮结果写成用户侧风险已完全解决、完整多格式平台交付或回答准确率提升。

## 工作区与安全边界

本轮未访问 Supabase、生产环境、模型服务或业务 API，未部署、提交或推送。原有 `proxy.ts`、`vitest.config.mts` 修改及工作区未跟踪文件保留。最终 `git status` 应与本轮开始时的用户工作区变化一起解读，不对既有未跟踪文件做清理或归属推断。

## 追加闭环：2026-10-23

### 已完成的安全行为

- 解析结果包含 `review_required` 告警时，文档处理在分块和 Embedding 前失败，不发布新 chunks，不进入 `ready`。复用现有 `failed` 状态，没有增加数据库状态或迁移。
- PDF 扫描页告警会持久化到错误消息，含受影响页码及 OCR/文本版补救说明。
- DOCX 表格被扁平化、图片或嵌入对象未解析时会产生复核告警；表格关系不完整的文件不会被当作可问答的完整文档。
- Workspace 读取文档状态、错误消息和历史处理 metadata，映射告警、位置、补救建议与 `qaEligible`。失败文档和仍处于 `ready` 但旧 metadata 带复核告警的文档不会计入可问答统计。
- Retriever 在 QA 消费结果前排除历史 `ready` 文档中带 `review_required` 告警的 chunks，并重新编号剩余结果。既有数据库 RPC 仍只选择 `ready`；本轮未修改数据库或迁移。

### 20 份文档结果

| ID | 格式 | 实际 parser 结果 | 告警/限制 | 问答准入 |
| --- | --- | --- | --- | --- |
| doc-001 | PDF | PASS | 无 parser 告警 | parser-only，未运行 QA |
| doc-002 | PDF | PASS | 无 parser 告警 | parser-only，未运行 QA |
| doc-003 | PDF | PARTIAL | 混合扫描，页 2 无可提取文本 | 应复核，不准入 |
| doc-004 | PDF | PASS | 无 parser 告警 | parser-only，未运行 QA |
| doc-005 | 扫描 PDF | PARTIAL | `EMPTY_DOCUMENT`；无本地 OCR | 不准入 |
| doc-006 | DOCX | PASS | 当前测试范围内无告警 | parser-only，未运行 QA |
| doc-007 | DOCX | PARTIAL | 表格行列关系未保留 | 应复核，不准入 |
| doc-008 | DOCX | PASS | 当前测试范围内无告警 | parser-only，未运行 QA |
| doc-009 | DOCX | PASS | 当前测试范围内无告警 | parser-only，未运行 QA |
| doc-010 | Markdown | PASS | 无 parser 告警 | parser-only，未运行 QA |
| doc-011 | Markdown | PASS | 无 parser 告警 | parser-only，未运行 QA |
| doc-012 | Markdown | PASS | 无 parser 告警 | parser-only，未运行 QA |
| doc-013 | TXT | PASS | 无 parser 告警 | parser-only，未运行 QA |
| doc-014 | TXT | PASS | 无 parser 告警 | parser-only，未运行 QA |
| doc-015 | TXT | PASS | 无 parser 告警 | parser-only，未运行 QA |
| doc-016 | XLSX | UNSUPPORTED | 没有应用 parser | 不准入 |
| doc-017 | XLSX | UNSUPPORTED | 没有应用 parser | 不准入 |
| doc-018 | PPTX | UNSUPPORTED | 没有应用 parser | 不准入 |
| doc-019 | PPTX | UNSUPPORTED | 没有应用 parser | 不准入 |
| doc-020 | PNG | UNSUPPORTED | 没有应用 OCR/parser | 不准入 |

Fixture parser 状态为 12 PASS、3 PARTIAL、5 UNSUPPORTED。这里的 `PASS` 仅表示现有 parser 未返回告警，不代表真实上传流程或 RAG 问答通过。

### 40 个问题与 RAG

- `case-001`–`case-004`、`case-007`–`case-008`、`case-011`–`case-012`、`case-015`–`case-030`：共 24 条 `PARSER_EVIDENCE_PRESENT_RAG_NOT_EXECUTED`。这只表示预期证据字符串出现在 parser 输出中。
- `case-005`–`case-006`、`case-009`–`case-010`、`case-013`–`case-014`：共 6 条 `REVIEW_REQUIRED_RAG_NOT_EXECUTED`。
- `case-031`–`case-040`：共 10 条 `UNSUPPORTED_RAG_NOT_EXECUTED`。DOCX 表格告警使两条表格问题归入复核组；最终分组为 24 parser evidence、6 review、10 unsupported，与 `actual-results.v1.json` 一致。
- 真实 Embedding、Supabase 写入、向量检索、生成模型、拒答和引用校验：0 条执行，全部 `UNVERIFIED/BLOCKED`。没有 Mock/离线替代被计为真实 RAG。

测试集核验：manifest 含 20 个唯一文档 ID、40 个唯一 case ID；20 个 fixture 均存在且 manifest SHA-256 一致。Ground Truth 保存在 `corpus-spec.v1.json`，parser 评测未读取其答案来生成检索或模型结果。

### Workspace 与问答准入证据

- 新增处理服务测试证明混合扫描 PDF 在 embedding 调用前失败，保留页码，且没有持久化 chunks。
- 新增 Workspace mapper/API 测试覆盖解析质量、告警位置、补救建议和 `qaEligible=false`。
- 新增 Retriever 测试覆盖历史 `ready` 文档带扫描告警时不进入 QA chunks。
- 这些是本地单元/契约测试，不是连接 Supabase 后执行的集成测试或在线 UI 验收。实际 Supabase schema/数据仍未写入、未查询。

### 自动化命令与结果

- `npm test -- --run src/features/knowledge-processing/content/parser.test.ts src/features/knowledge-processing/content/extraction-warnings.test.ts src/features/knowledge-processing/application/document-processing-service.test.ts src/features/workspace/application/workspace-mapper.test.ts src/components/phase75/phase75-workspace.test.ts evals/document-reliability/corpus-eval.test.ts`：6 个文件、26 项测试通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- `npm run build`：未验证。Next/Turbopack 在沙箱中因创建进程/绑定端口被禁止而失败；未通过提权绕过。构建输出显示加载 `.env.local` 文件名，未打印变量值；未证明完整 build 不会触发任何外部路径。

### 安全与最终结论

没有调用真实 Supabase、数据库、Storage、模型或业务 API；没有部署、提交或推送。没有创建数据库迁移。原始 `proxy.ts`、`vitest.config.mts` 改动和既有未跟踪工作继续保留；本轮新增代码/测试及 corpus evaluator 更新是本任务范围内的改动。`npm run build` 可能更新被忽略的 `.next` 构建目录，本轮未清理该目录。

最终状态仍为 `PARTIAL`：告警到准入闭环的本地实现已通过相关自动化测试；但 XLSX、PPTX、PNG/JPG OCR 与手写识别未实现，真实 RAG 没有安全隔离的本地后端/模型条件，生产 build 也未获验证。因此不满足 20/20、40/40 和真实 RAG 的 PASS 门槛。

