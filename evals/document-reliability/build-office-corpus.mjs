import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Presentation, PresentationFile, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const fixtureDir = path.join(root, "fixtures");
const qaDir = "/private/tmp/novera-document-reliability-qa";
await fs.mkdir(fixtureDir, { recursive: true });
await fs.mkdir(qaDir, { recursive: true });

async function saveBlob(blob, target) {
  await blob.save(target);
}

async function buildWorkbook(fileName, title, headers, rows, outputPath) {
  if (await fileExists(outputPath)) return;
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add("数据");
  sheet.showGridLines = false;
  sheet.getRange("A1:C1").values = [[title, "", ""]];
  sheet.mergeCells("A1:C1");
  sheet.getRange("A1:C1").format = {
    font: { name: "Arial", size: 14, bold: true, color: "#1D2939" },
  };
  sheet.getRange("A3:C6").values = [
    headers,
    ...rows,
  ];
  sheet.getRange("A3:C3").format = {
    fill: "#2F6B5B",
    font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  sheet.getRange("A3:C6").format.borders = { preset: "all", style: "thin", color: "#D9D9D9" };
  sheet.getRange("A4:A6").format.font = { name: "Arial", size: 10 };
  sheet.getRange("B4:B6").format = { font: { name: "Arial", size: 10 }, numberFormat: "0" };
  sheet.getRange("C4:C6").format = { font: { name: "Arial", size: 10 }, numberFormat: "0.0" };
  sheet.getRange("A1:C6").format.verticalAlignment = "center";
  sheet.getRange("A1:C6").format.autofitColumns();
  sheet.getRange("A1:C6").format.autofitRows();
  sheet.freezePanes.freezeRows(3);
  workbook.recalculate();
  const inspection = await workbook.inspect({ kind: "table", range: "数据!A1:C6", include: "values,formulas", tableMaxRows: 8, tableMaxCols: 4 });
  await fs.writeFile(path.join(qaDir, `${path.basename(fileName)}.inspect.ndjson`), inspection.ndjson, "utf8");
  const preview = await workbook.render({ sheetName: "数据", autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(qaDir, `${path.basename(fileName)}.png`), new Uint8Array(await preview.arrayBuffer()));
  await saveBlob(await SpreadsheetFile.exportXlsx(workbook), outputPath);
}

async function buildDeck(fileName, title, slides, outputPath) {
  if (await fileExists(outputPath)) return;
  const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });
  for (const item of slides) {
    const slide = presentation.slides.add();
    slide.background.fill = "#F8FAFC";
    const heading = slide.shapes.add({ geometry: "textbox", position: { left: 72, top: 62, width: 1060, height: 62 }, fill: "none", line: { style: "solid", fill: "none", width: 0 } });
    heading.text = item.title;
    heading.text.style = { fontSize: 34, bold: true, color: "#1D2939", typeface: "Arial" };
    const body = slide.shapes.add({ geometry: "textbox", position: { left: 88, top: 168, width: 520, height: 300 }, fill: "none", line: { style: "solid", fill: "none", width: 0 } });
    body.text = item.body.join("\n");
    body.text.style = { fontSize: 22, color: "#344054", typeface: "Arial" };
    slide.charts.add("bar", {
      position: { left: 720, top: 168, width: 420, height: 280 },
      categories: item.categories,
      series: [{ name: item.seriesName, values: item.values, fill: "#2F6B5B" }],
      hasLegend: false,
      dataLabels: { showValue: true, position: "outEnd" },
      yAxis: { majorGridlines: { style: "solid", fill: "#D0D5DD", width: 1 } },
    });
    const footer = slide.shapes.add({ geometry: "textbox", position: { left: 88, top: 620, width: 600, height: 30 }, fill: "none", line: { style: "solid", fill: "none", width: 0 } });
    footer.text = "Synthetic test document. Values are fictional.";
    footer.text.style = { fontSize: 14, color: "#667085", typeface: "Arial" };
  }
  const inspection = await presentation.inspect({ kind: "slide,textbox,chart,layout", maxChars: 10000 });
  await fs.writeFile(path.join(qaDir, `${path.basename(fileName)}.inspect.ndjson`), inspection.ndjson, "utf8");
  for (const [index, slide] of presentation.slides.items.entries()) {
    const png = await presentation.export({ slide, format: "png", scale: 1 });
    await fs.writeFile(path.join(qaDir, `${path.basename(fileName)}-slide-${index + 1}.png`), new Uint8Array(await png.arrayBuffer()));
  }
  await saveBlob(await PresentationFile.exportPptx(presentation), outputPath);
}

async function fileExists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

await buildWorkbook(
  "16_revenue_by_region.xlsx",
  "区域收入工作簿",
  ["区域", "年份", "营业收入（百万元）"],
  [["华东", 2025, 42.6], ["华南", 2025, 31.8], ["华北", 2025, 27.4]],
  path.join(fixtureDir, "16_revenue_by_region.xlsx"),
);
await buildWorkbook(
  "17_risk_register.xlsx",
  "运输风险台账",
  ["风险", "优先级", "措施"],
  [["极端天气延误", "中", "增加备用路线"], ["扫描件识别缺失", "高", "OCR 前人工复核"], ["运输高峰拥堵", "中", "提前调度车辆"]],
  path.join(fixtureDir, "17_risk_register.xlsx"),
);
await buildDeck(
  "18_quarterly_strategy.pptx",
  "2025 年第四季度产品计划",
  [
    { title: "第四季度产品计划", body: ["目标：缩短知识库处理失败后的恢复时间", "重试成功率目标：85%"], categories: ["目标"], values: [85], seriesName: "百分比" },
    { title: "衡量方式", body: ["观察处理失败到重新进入队列的时间", "不将目标值描述为已实现结果"], categories: ["计划"], values: [1], seriesName: "说明" },
  ],
  path.join(fixtureDir, "18_quarterly_strategy.pptx"),
);
await buildDeck(
  "19_capacity_review.pptx",
  "分拣中心产能复盘",
  [
    { title: "产能复盘", body: ["日均处理量：5,180 件", "设计能力：5,600 件"], categories: ["日均处理量", "设计能力"], values: [5180, 5600], seriesName: "件" },
    { title: "下一步", body: ["增加周末抽检", "扫描页指标进入人工核对队列"], categories: ["抽检", "人工核对"], values: [1, 1], seriesName: "事项" },
  ],
  path.join(fixtureDir, "19_capacity_review.pptx"),
);

const manifestPath = path.join(root, "manifest.v1.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const officeNames = new Set(["16_revenue_by_region.xlsx", "17_risk_register.xlsx", "18_quarterly_strategy.pptx", "19_capacity_review.pptx"]);
const officeDocs = [];
for (const name of officeNames) {
  const specId = name.startsWith("16_") ? "doc-016" : name.startsWith("17_") ? "doc-017" : name.startsWith("18_") ? "doc-018" : "doc-019";
  const source = { "doc-016": { company_name: "青屿精工", document_title: "区域收入工作簿", expected_capability: "unsupported_parser", expected_behavior: "当前解析层拒绝 XLSX，不把表格数据标记为已处理", known_limitations: ["当前应用没有 XLSX parser。"], file_format: "xlsx" }, "doc-017": { company_name: "云海物流", document_title: "运输风险台账", expected_capability: "unsupported_parser", expected_behavior: "明确拒绝未支持的 XLSX 格式", known_limitations: ["不评估公式、隐藏表、批注、图表或多工作表引用。"], file_format: "xlsx" }, "doc-018": { company_name: "栖木软件", document_title: "2025 年第四季度产品计划", expected_capability: "unsupported_parser", expected_behavior: "当前解析层拒绝 PPTX，要求另存为支持格式", known_limitations: ["解析层不处理幻灯片、备注或图形文本。"], file_format: "pptx" }, "doc-019": { company_name: "云海物流", document_title: "分拣中心产能复盘", expected_capability: "unsupported_parser", expected_behavior: "以明确不支持替代静默空结果", known_limitations: ["图表数据、演讲者备注和布局语义均不在本轮支持范围。"], file_format: "pptx" } }[specId];
  const fullPath = path.join(fixtureDir, name);
  const bytes = await fs.readFile(fullPath);
  officeDocs.push({
    document_id: specId,
    file_name: name,
    file_format: source.file_format,
    source_type: "synthetic",
    company_name: source.company_name,
    document_title: source.document_title,
    document_version: "v1",
    mime_type: source.file_format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    document_hash: (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"),
    expected_capability: source.expected_capability,
    expected_behavior: source.expected_behavior,
    execution_status: "NOT_RUN",
    actual_behavior: "Awaiting local parser evaluation.",
    known_limitations: source.known_limitations,
  });
}
manifest.documents = manifest.documents.filter((document) => !officeNames.has(document.file_name));
manifest.documents.push(...officeDocs);
manifest.documents.sort((a, b) => a.document_id.localeCompare(b.document_id));
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log("Created XLSX and PPTX fixtures.");
