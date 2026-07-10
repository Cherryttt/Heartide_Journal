from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "PROJECT_REPORT.md"
OUT_DIR = ROOT / "docs" / "out"
PDF_OUT = OUT_DIR / "心潮手帐项目报告.pdf"

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))

BLUE = colors.HexColor("#2E74B5")
DARK_BLUE = colors.HexColor("#1F4D78")
NAVY = colors.HexColor("#203748")
MUTED = colors.HexColor("#626C74")
LIGHT_FILL = colors.HexColor("#F4F6F9")
TABLE_FILL = colors.HexColor("#F2F4F7")
BORDER = colors.HexColor("#D7DBE2")


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title",
            parent=base["Title"],
            fontName="STSong-Light",
            fontSize=29,
            leading=38,
            textColor=NAVY,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["Normal"],
            fontName="STSong-Light",
            fontSize=16,
            leading=22,
            textColor=DARK_BLUE,
            alignment=TA_CENTER,
            spaceAfter=20,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="STSong-Light",
            fontSize=10.5,
            leading=16,
            textColor=colors.HexColor("#222222"),
            wordWrap="CJK",
            spaceAfter=8,
        ),
        "muted": ParagraphStyle(
            "muted",
            parent=base["Normal"],
            fontName="STSong-Light",
            fontSize=9.5,
            leading=14,
            textColor=MUTED,
            wordWrap="CJK",
            spaceAfter=6,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="STSong-Light",
            fontSize=16,
            leading=22,
            textColor=BLUE,
            spaceBefore=14,
            spaceAfter=8,
            wordWrap="CJK",
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="STSong-Light",
            fontSize=13,
            leading=18,
            textColor=BLUE,
            spaceBefore=10,
            spaceAfter=6,
            wordWrap="CJK",
        ),
        "bullet": ParagraphStyle(
            "bullet",
            parent=base["Normal"],
            fontName="STSong-Light",
            fontSize=10,
            leading=15,
            leftIndent=18,
            firstLineIndent=-10,
            textColor=colors.HexColor("#222222"),
            wordWrap="CJK",
            spaceAfter=4,
        ),
        "code": ParagraphStyle(
            "code",
            parent=base["Normal"],
            fontName="STSong-Light",
            fontSize=8.3,
            leading=11,
            textColor=colors.HexColor("#2D3237"),
            wordWrap="CJK",
        ),
        "table": ParagraphStyle(
            "table",
            parent=base["Normal"],
            fontName="STSong-Light",
            fontSize=8.8,
            leading=12,
            textColor=colors.HexColor("#222222"),
            wordWrap="CJK",
        ),
    }


S = styles()


def clean(text: str) -> str:
    text = text.replace("**", "")
    text = re.sub(r"`([^`]+)`", r"<font color='#1F4D78'>\1</font>", html.escape(text))
    return text


def para(text: str, style="body"):
    return Paragraph(clean(text), S[style])


def is_table_start(lines, idx):
    return idx + 1 < len(lines) and lines[idx].strip().startswith("|") and re.match(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$", lines[idx + 1])


def parse_table(lines, idx):
    block = []
    while idx < len(lines) and lines[idx].strip().startswith("|"):
        block.append(lines[idx].strip())
        idx += 1
    header = [c.strip() for c in block[0].strip("|").split("|")]
    rows = [[c.strip() for c in row.strip("|").split("|")] for row in block[2:]]
    return header, rows, idx


def table_flow(header, rows):
    data = [[Paragraph(clean(c), S["table"]) for c in header]]
    data += [[Paragraph(clean(c), S["table"]) for c in row[: len(header)]] for row in rows]
    width = 6.5 * inch
    if len(header) == 2:
        col_widths = [1.75 * inch, 4.75 * inch]
    elif len(header) == 3:
        col_widths = [1.45 * inch, 2.5 * inch, 2.55 * inch]
    else:
        col_widths = [width / max(len(header), 1)] * len(header)
    t = Table(data, colWidths=col_widths, hAlign="CENTER", repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_FILL),
        ("TEXTCOLOR", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.35, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return [t, Spacer(1, 8)]


def code_flow(lines):
    content = "<br/>".join(html.escape(line if line else " ") for line in lines)
    t = Table([[Paragraph(content, S["code"])]], colWidths=[6.5 * inch], hAlign="CENTER")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7F7F7")),
        ("BOX", (0, 0), (-1, -1), 0.35, colors.HexColor("#E2E4E8")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return [t, Spacer(1, 8)]


def cover():
    story = [Spacer(1, 1.2 * inch)]
    story.append(Paragraph("项目报告", ParagraphStyle("kicker", fontName="STSong-Light", fontSize=12, textColor=BLUE, alignment=TA_CENTER, spaceAfter=14)))
    story.append(Paragraph("《心潮手帐》", S["title"]))
    story.append(Paragraph("智能情绪陪伴系统", S["subtitle"]))
    story.append(Paragraph("融合情绪识别、阅读推荐、AI 文学陪伴与可视化手账创作的全栈智能应用", S["muted"]))
    story.append(Spacer(1, 0.35 * inch))
    rows = [
        ["系统名称", "心潮手帐 Heartide Journal"],
        ["项目类型", "智能情绪记录、阅读疗愈与手账创作系统"],
        ["技术方向", "机器学习 + 大模型生成 + 推荐系统 + 前后端工程"],
        ["生成日期", "2026 年 6 月 16 日"],
    ]
    story.extend(table_flow(rows[0], rows[1:]))
    story.append(PageBreak())
    return story


def toc():
    items = [
        "一、项目概述",
        "二、系统技术栈",
        "三、系统架构",
        "四、主要功能模块",
        "五、情绪模型与训练数据",
        "六、Prompt 设计",
        "七、生图模型 API 接入状态",
        "八、安全与生产化设计",
        "九、测试与验证",
        "十、项目亮点",
        "十一、当前局限与后续优化",
        "十二、答辩总结话术",
    ]
    story = [Paragraph("目录", S["h1"])]
    for item in items:
        story.append(para("• " + item, "bullet"))
    story.append(PageBreak())
    return story


def markdown_story(markdown: str):
    lines = markdown.splitlines()
    story = []
    idx = 0
    in_code = False
    code_lines = []
    skip_title = True

    while idx < len(lines):
        line = lines[idx].rstrip()
        stripped = line.strip()
        if stripped.startswith("```"):
            if in_code:
                story.extend(code_flow(code_lines))
                code_lines = []
                in_code = False
            else:
                in_code = True
            idx += 1
            continue
        if in_code:
            code_lines.append(line)
            idx += 1
            continue
        if not stripped:
            idx += 1
            continue
        if is_table_start(lines, idx):
            header, rows, idx = parse_table(lines, idx)
            story.extend(table_flow(header, rows))
            continue
        if stripped.startswith("# "):
            if skip_title:
                skip_title = False
            else:
                story.append(Paragraph(clean(stripped[2:]), S["h1"]))
            idx += 1
            continue
        if stripped.startswith("## "):
            story.append(Paragraph(clean(stripped[3:]), S["h1"]))
            idx += 1
            continue
        if stripped.startswith("### "):
            story.append(Paragraph(clean(stripped[4:]), S["h2"]))
            idx += 1
            continue
        if stripped.startswith("- "):
            story.append(para("• " + stripped[2:], "bullet"))
            idx += 1
            continue
        if re.match(r"^\d+\.\s+", stripped):
            story.append(para(stripped, "bullet"))
            idx += 1
            continue
        story.append(para(stripped))
        idx += 1
    return story


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("STSong-Light", 8.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(doc.leftMargin, 0.55 * inch, "心潮手帐 | 智能情绪陪伴系统项目报告")
    canvas.drawRightString(letter[0] - doc.rightMargin, 0.55 * inch, f"第 {doc.page} 页")
    canvas.restoreState()


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(PDF_OUT),
        pagesize=letter,
        leftMargin=inch,
        rightMargin=inch,
        topMargin=inch,
        bottomMargin=inch,
        title="心潮手帐项目报告",
        author="MoodGarden Project",
    )
    story = []
    story.extend(cover())
    story.extend(toc())
    story.extend(markdown_story(SOURCE.read_text(encoding="utf-8")))
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(PDF_OUT)


if __name__ == "__main__":
    main()
