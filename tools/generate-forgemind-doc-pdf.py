from html import escape
from pathlib import Path
import re
import shutil

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    PageBreak,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "ForgeMind-官方文档.pdf"
PUBLIC = ROOT / "public" / "docs" / "ForgeMind-官方文档.pdf"
FONT = Path(r"C:\Windows\Fonts\NotoSansSC-VF.ttf")
DOCUMENT_PATHS = [
    ROOT / "docs" / "ForgeMind-用户使用手册.md",
    ROOT / "docs" / "ForgeMind-功能模块技术文档.md",
    ROOT / "docs" / "ForgeMind-模块用户文档.md",
    ROOT / "docs" / "ForgePass-用户文档.md",
    ROOT / "docs" / "ForgeCloud-用户文档.md",
    ROOT / "docs" / "ForgeHub-用户文档.md",
    ROOT / "docs" / "ForgeLab-用户文档.md",
    ROOT / "docs" / "ForgeMove-用户文档.md",
    ROOT / "docs" / "Forge生态-模块技术文档.md",
]

pdfmetrics.registerFont(TTFont("NotoSansSC", str(FONT)))


def clean_inline(value: str) -> str:
    value = re.sub(r"!\[([^]]*)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"\[([^]]+)\]\(([^)]+)\)", r"\1", value)
    value = value.replace("**", "").replace("`", "")
    return escape(value)


class ForgeMindDoc(BaseDocTemplate):
    def __init__(self, filename, **kwargs):
        super().__init__(filename, **kwargs)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="normal")
        self.addPageTemplates([PageTemplate(id="forgemind", frames=frame, onPage=draw_page)])


def draw_page(canvas, doc):
    canvas.saveState()
    width, height = A4
    if doc.page == 1:
        canvas.setFillColor(colors.HexColor("#111518"))
        canvas.rect(0, height - 8 * mm, width, 8 * mm, fill=1, stroke=0)
    else:
        canvas.setStrokeColor(colors.HexColor("#dfe3e1"))
        canvas.line(doc.leftMargin, height - 16 * mm, width - doc.rightMargin, height - 16 * mm)
        canvas.setFont("NotoSansSC", 7)
        canvas.setFillColor(colors.HexColor("#858d91"))
        canvas.drawString(doc.leftMargin, height - 12 * mm, "FORGEMIND / OFFICIAL DOCUMENT")
        canvas.drawRightString(width - doc.rightMargin, height - 12 * mm, "DIGITAL FACTORY OS")
    canvas.setStrokeColor(colors.HexColor("#dfe3e1"))
    canvas.line(doc.leftMargin, 14 * mm, width - doc.rightMargin, 14 * mm)
    canvas.setFont("NotoSansSC", 7)
    canvas.setFillColor(colors.HexColor("#858d91"))
    canvas.drawString(doc.leftMargin, 9 * mm, "ForgeMind Studio · 2026.09.07")
    canvas.drawRightString(width - doc.rightMargin, 9 * mm, f"{doc.page:02d}")
    canvas.restoreState()


styles = getSampleStyleSheet()
title = ParagraphStyle("title", parent=styles["Title"], fontName="NotoSansSC", fontSize=28, leading=35, textColor=colors.white, alignment=TA_LEFT, spaceAfter=12)
subtitle = ParagraphStyle("subtitle", parent=styles["Normal"], fontName="NotoSansSC", fontSize=11, leading=18, textColor=colors.HexColor("#c6d4d0"), spaceAfter=5)
chapter = ParagraphStyle("chapter", parent=styles["Heading1"], fontName="NotoSansSC", fontSize=22, leading=28, textColor=colors.HexColor("#171b1e"), spaceBefore=12, spaceAfter=14)
h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontName="NotoSansSC", fontSize=15, leading=21, textColor=colors.HexColor("#7957e8"), spaceBefore=13, spaceAfter=7)
h3 = ParagraphStyle("h3", parent=styles["Heading3"], fontName="NotoSansSC", fontSize=11, leading=17, textColor=colors.HexColor("#202529"), spaceBefore=10, spaceAfter=5)
body = ParagraphStyle("body", parent=styles["BodyText"], fontName="NotoSansSC", fontSize=9.2, leading=16, textColor=colors.HexColor("#4f585d"), alignment=TA_LEFT, spaceAfter=7)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=13, firstLineIndent=-8, bulletIndent=0, spaceAfter=3)
small = ParagraphStyle("small", parent=body, fontSize=8, leading=12, textColor=colors.HexColor("#7a8388"))
code = ParagraphStyle("code", parent=body, fontName="NotoSansSC", fontSize=7.2, leading=11, textColor=colors.HexColor("#dbe8e3"), backColor=colors.HexColor("#151c1f"), borderPadding=8)
table_head = ParagraphStyle("table_head", parent=body, fontSize=8, leading=12, textColor=colors.white)
table_cell = ParagraphStyle("table_cell", parent=body, fontSize=7.4, leading=11, spaceAfter=0)


def parse_markdown(path: Path):
    lines = path.read_text(encoding="utf-8").replace("\r", "").split("\n")
    story = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith("```"):
            rows = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                rows.append(lines[i])
                i += 1
            story.append(Preformatted("\n".join(rows), code))
            story.append(Spacer(1, 3 * mm))
            i += 1
            continue
        heading = re.match(r"^(#{1,3})\s+(.+)$", line)
        if heading:
            text = clean_inline(re.sub(r"\s+#$", "", heading.group(2)))
            style = chapter if len(heading.group(1)) == 1 else h2 if len(heading.group(1)) == 2 else h3
            story.append(Paragraph(text, style))
            i += 1
            continue
        if line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [cell.strip() for cell in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", cell) for cell in cells):
                    rows.append([Paragraph(clean_inline(cell), table_cell) for cell in cells])
                i += 1
            if rows:
                rows[0] = [Paragraph(cell.getPlainText(), table_head) for cell in rows[0]]
                table = Table(rows, repeatRows=1, colWidths=None, hAlign="LEFT")
                table.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#151c1f")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#f4f6f5")),
                    ("GRID", (0, 0), (-1, -1), .35, colors.HexColor("#d9dfdd")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]))
                story.extend([table, Spacer(1, 3 * mm)])
            continue
        if re.match(r"^[-*]\s+", line):
            story.append(Paragraph("• " + clean_inline(re.sub(r"^[-*]\s+", "", line)), bullet))
            i += 1
            continue
        if line == "---":
            story.append(Spacer(1, 3 * mm))
            i += 1
            continue
        paragraph = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,3})\s+|^```|^\||^[-*]\s+|^---$", lines[i].strip()):
            paragraph.append(lines[i].strip())
            i += 1
        story.append(Paragraph(clean_inline(" ".join(paragraph)), body))
    return story


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    story = [Spacer(1, 32 * mm)]
    cover = Table([[Paragraph("ForgeMind", title)], [Paragraph("官方产品与技术文档", subtitle)], [Spacer(1, 10 * mm)], [Paragraph("DIGITAL FACTORY OS  ·  BUILD 0.1.0  ·  UPDATED 2026.09.07", subtitle)]], colWidths=[150 * mm], rowHeights=[None, None, None, None])
    cover.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#111518")),
        ("LEFTPADDING", (0, 0), (-1, -1), 16 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 16 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 10 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10 * mm),
        ("LINEBELOW", (0, 0), (-1, 0), 3, colors.HexColor("#eab51b")),
    ]))
    story += [cover, Spacer(1, 12 * mm), Paragraph("这份文档汇总 ForgeMind 及 ForgePass、ForgeCloud、ForgeHub、ForgeLab、ForgeMove 的使用方式、产品能力、系统边界、数据模型和验证规则。内容以当前代码、数据库迁移和已执行验证为准。", body), PageBreak()]
    story += [Paragraph("阅读地图", chapter), Paragraph("从核心用户操作开始，再进入各模块的独立指南和生态技术边界。若只想快速上手，先读对应模块用户文档；若需要扩展、排查或接入服务，阅读核心技术说明和生态模块技术文档。", body)]
    story += [Paragraph("文档组成", h2), Paragraph("01  核心用户手册　ForgeMind 的启动、登录、建造、生产、仓储、仿真、诊断、存档与排障。", body), Paragraph("02  核心技术说明　前端状态、确定性仿真、三维渲染、后端、Agent、AI 和数据不变量。", body), Paragraph("03  模块用户文档　ForgeMind、ForgePass、ForgeCloud、ForgeHub、ForgeLab、ForgeMove 的逐模块使用路径。", body), Paragraph("04  生态模块技术文档　身份流、职责边界、接口、权限、数据流和验证入口。", body), PageBreak()]
    for index, path in enumerate(DOCUMENT_PATHS):
        story += parse_markdown(path)
        if index < len(DOCUMENT_PATHS) - 1:
            story.append(PageBreak())
    ForgeMindDoc(str(OUTPUT), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=23 * mm, bottomMargin=20 * mm, title="ForgeMind 官方产品与技术文档", author="ForgeMind Studio").build(story)
    shutil.copy2(OUTPUT, PUBLIC)
    print(OUTPUT)


if __name__ == "__main__":
    build()
