from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


OUT = "产品分析实验测试文档.docx"


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_border(cell, color="D9D9D9", size="6"):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = "w:" + edge
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), color)


def set_cell_margins(cell, top=100, start=120, bottom=100, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for m, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn("w:" + m))
        if node is None:
            node = OxmlElement("w:" + m)
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_run_font(run, size=11, bold=False, color="000000"):
    run.font.name = "Hiragino Sans GB"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Hiragino Sans GB")
    run.font.size = Pt(size)
    run.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)


def style_paragraph(paragraph, space_after=6, line=1.2):
    paragraph.paragraph_format.space_after = Pt(space_after)
    paragraph.paragraph_format.line_spacing = line


def add_heading(doc, text, level=1):
    p = doc.add_paragraph(style=f"Heading {level}")
    p.paragraph_format.space_before = Pt(12 if level == 1 else 8)
    p.paragraph_format.space_after = Pt(5)
    r = p.add_run(text)
    set_run_font(r, size=14 if level == 1 else 12, bold=True)
    return p


def add_body(doc, text, bold_lead=None):
    p = doc.add_paragraph()
    style_paragraph(p)
    if bold_lead and text.startswith(bold_lead):
        r = p.add_run(bold_lead)
        set_run_font(r, bold=True)
        r2 = p.add_run(text[len(bold_lead):])
        set_run_font(r2)
    else:
        r = p.add_run(text)
        set_run_font(r)
    return p


def add_bullet(doc, text):
    p = doc.add_paragraph(style="List Bullet")
    style_paragraph(p, space_after=3)
    r = p.add_run(text)
    set_run_font(r)
    return p


def add_table(doc, headers, rows, widths=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    hdr = table.rows[0].cells
    for i, text in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        r = p.add_run(text)
        set_run_font(r, size=10, bold=True, color="FFFFFF")
        set_cell_shading(hdr[i], "44546A")
        set_cell_border(hdr[i])
        set_cell_margins(hdr[i])
        hdr[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        if widths:
            hdr[i].width = Inches(widths[i])
    for ridx, row in enumerate(rows):
        cells = table.add_row().cells
        for i, text in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            r = p.add_run(text)
            set_run_font(r, size=10)
            set_cell_shading(cells[i], "F2F4F7" if ridx % 2 else "FFFFFF")
            set_cell_border(cells[i])
            set_cell_margins(cells[i])
            cells[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if widths:
                cells[i].width = Inches(widths[i])
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return table


doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.top_margin = Inches(0.7)
section.bottom_margin = Inches(0.7)
section.left_margin = Inches(0.8)
section.right_margin = Inches(0.8)

styles = doc.styles
styles["Normal"].font.name = "Hiragino Sans GB"
styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), "Hiragino Sans GB")
styles["Normal"].font.size = Pt(11)
for name in ("Title", "Heading 1", "Heading 2"):
    styles[name].font.name = "Hiragino Sans GB"
    styles[name]._element.rPr.rFonts.set(qn("w:eastAsia"), "Hiragino Sans GB")
    styles[name].font.color.rgb = RGBColor(0, 0, 0)

# Remove the built-in title rule so the title remains plain and black.
title_style_pr = styles["Title"]._element.get_or_add_pPr()
title_borders = title_style_pr.find(qn("w:pBdr"))
if title_borders is not None:
    title_style_pr.remove(title_borders)

title = doc.add_paragraph(style="Title")
title.alignment = WD_ALIGN_PARAGRAPH.LEFT
title.paragraph_format.space_after = Pt(5)
r = title.add_run("产品分析实验测试文档")
set_run_font(r, size=22, bold=True)

# Ensure no direct paragraph border survives from the built-in Title style.
title_ppr = title._p.get_or_add_pPr()
title_borders = title_ppr.find(qn("w:pBdr"))
if title_borders is not None:
    title_ppr.remove(title_borders)

sub = doc.add_paragraph()
sub.paragraph_format.space_after = Pt(14)
r = sub.add_run("用于检索问答功能的上传测试与证据核验")
set_run_font(r, size=11, color="666666")

add_body(doc, "这份文档描述一个面向内容审核产品的对照实验。上传后可用它测试系统是否能准确提取目标、指标、分组、时间窗口、判断规则与风险信息。建议先完成上传，再依次使用文末的问题进行检索。", bold_lead="这份文档描述")

add_heading(doc, "一 实验背景与目标", 1)
add_body(doc, "团队计划评估新的审核提示词是否能减少人工复核时间，同时保持审核准确性。实验采用随机分组方式，对比现有提示词与新提示词在真实任务中的表现。")
add_body(doc, "核心目标是判断新提示词是否值得扩大使用范围。只有在准确性不下降、处理效率提升且没有明显安全风险时，才进入下一阶段。")

add_heading(doc, "二 指标定义", 1)
add_table(doc, ["指标类型", "指标名称", "定义与统计方式"], [
    ("主要指标", "审核准确率", "人工复核结论与系统结论一致的任务数，占全部有效任务数的比例。"),
    ("主要指标", "平均处理时长", "从任务提交到系统给出可用结论的平均时间，单位为分钟。"),
    ("辅助指标", "人工复核率", "需要人工二次确认的任务数，占全部有效任务数的比例。"),
    ("辅助指标", "严重误判率", "将高风险内容判断为低风险的任务数，占全部有效任务数的比例。"),
    ("辅助指标", "用户完成率", "在规定时间内完成审核流程的任务数，占分配任务数的比例。"),
], widths=[1.0, 1.4, 4.5])

add_heading(doc, "三 实验分组与样本", 1)
add_body(doc, "实验对象为过去 30 天内产生的审核任务。去除重复任务、缺少人工复核结论的任务以及测试账号产生的任务后，再进行随机分组。")
add_table(doc, ["分组", "使用方案", "计划样本量", "说明"], [
    ("对照组", "现有提示词", "500 个任务", "保持当前线上流程不变，用于建立基准。"),
    ("实验组", "新提示词", "500 个任务", "仅替换提示词，其余模型、数据源和审核流程保持一致。"),
], widths=[0.9, 1.7, 1.3, 3.0])

add_heading(doc, "四 实验流程与时间窗口", 1)
for item in [
    "准备阶段：确认两组使用相同的数据范围、权限配置和人工复核标准。",
    "运行阶段：连续运行 7 天，收集两组的主要指标和辅助指标。每天检查数据量、接口错误和严重误判案例。",
    "复核阶段：实验结束后，由两名复核人员独立抽查每组 50 个任务；若意见不一致，由第三名复核人员裁定。",
    "分析阶段：比较两组指标差异，并结合错误案例判断差异是否具有业务意义。",
]:
    add_bullet(doc, item)

add_heading(doc, "五 结果判断与后续决策", 1)
add_body(doc, "结果判断必须同时考虑统计差异和业务风险。单一指标变好，不代表方案可以直接上线。")
add_table(doc, ["情形", "决策"], [
    ("准确率提升至少 3 个百分点，平均处理时长下降至少 15%，且严重误判率不高于对照组", "扩大到 50% 流量，再观察 7 天。"),
    ("效率提升，但准确率下降超过 1 个百分点，或出现新的严重误判类型", "暂停扩大，定位错误案例并修改方案。"),
    ("两组差异不明显，且置信区间覆盖无差异", "暂不切换，补充样本或重新设计实验。"),
    ("出现数据泄露、权限越界或无法解释的异常结果", "立即停止实验，保留日志并进行安全排查。"),
], widths=[4.7, 2.2])

add_heading(doc, "六 风险与限制", 1)
for item in [
    "7 天观察窗口可能无法覆盖周末、节假日或业务高峰带来的任务结构变化。",
    "人工复核标准存在主观差异，复核人员需要先完成统一培训并使用同一份判定规则。",
    "如果两组任务来源或难度不均衡，指标差异可能来自样本偏差，而不是提示词效果。",
    "严重误判样本通常较少，不能只依靠总体比例，还要逐条检查具体案例。",
]:
    add_bullet(doc, item)

add_heading(doc, "七 术语说明", 1)
add_body(doc, "有效任务：具备完整输入、系统结果和人工复核结论，且不属于重复任务或测试任务。")
add_body(doc, "严重误判：将需要拦截、升级或人工复核的高风险内容错误判断为可直接通过。")
add_body(doc, "扩大流量：在保持监控和回滚能力的前提下，提高实验方案覆盖的线上任务比例。")

add_heading(doc, "八 测试提示", 1)
add_body(doc, "上传后可使用下列问题检验系统是否能从文档中返回准确、可核验的答案。先问文档明确写出的事实，再问文档没有给出的信息，以检查系统是否会诚实区分已知内容与缺失内容。")

doc.save(OUT)
print(OUT)
