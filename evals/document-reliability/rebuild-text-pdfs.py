#!/usr/bin/env python3
"""Create only the four text-based PDF fixtures that were moved for font-control repair."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent
SPEC = json.loads((ROOT / "corpus-spec.v1.json").read_text(encoding="utf-8"))
OUT = ROOT / "fixtures"
FONT_CANDIDATES = [Path("/System/Library/Fonts/Supplemental/Arial.ttf"), Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf")]


def image_page(text: str, path: Path) -> None:
    image = Image.new("RGB", (1275, 1650), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    for candidate in FONT_CANDIDATES:
        if candidate.is_file():
            try:
                font = ImageFont.truetype(str(candidate), size=42)
                break
            except OSError:
                pass
    y = 170
    for line in text.splitlines():
        draw.text((100, y), line, fill="#222222", font=font)
        y += 90
    image.save(path, format="PNG")


def build_pdf(document: dict) -> None:
    path = OUT / document["file_name"]
    if path.exists():
        raise FileExistsError(f"Refusing to overwrite existing fixture: {path}")
    pdf = canvas.Canvas(str(path), pagesize=letter, pageCompression=0)
    width, height = letter
    pdf.setTitle(document["document_title"])
    for index, page in enumerate(document["content"]["pages"]):
        if isinstance(page, dict) and page.get("kind") == "image":
            image_path = OUT / f".{document['document_id']}-scan-{index + 1}.png"
            image_page(page["text"], image_path)
            pdf.drawImage(str(image_path), 0, 0, width=width, height=height)
            image_path.unlink()
        else:
            text = page["text"] if isinstance(page, dict) else page
            pdf.setFont("Helvetica", 13)
            y = height - 64
            for line in text.splitlines():
                pdf.drawString(58, y, line)
                y -= 24
        pdf.showPage()
    pdf.save()


for document in SPEC["documents"]:
    if document["document_id"] in {"doc-001", "doc-002", "doc-003", "doc-004"}:
        build_pdf(document)
manifest_path = ROOT / "manifest.v1.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
for item in manifest["documents"]:
    if item["document_id"] in {"doc-001", "doc-002", "doc-003", "doc-004"}:
        content = (OUT / item["file_name"]).read_bytes()
        item["document_hash"] = hashlib.sha256(content).hexdigest()
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Rebuilt four text PDF fixtures without overwriting existing files.")
