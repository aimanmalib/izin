"""Build the submission deck from deck/slides.yaml.

Run from the repository root:
    uv run --with python-pptx==1.0.2 --with pyyaml==6.0.2 python deck/build.py

All text, colours and image paths come from the YAML file; this script only lays them out.
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
SLIDE_W, SLIDE_H = 13.333, 7.5
MARGIN = 0.6


class Deck:
    def __init__(self, spec: dict):
        self.spec = spec
        self.t = spec["theme"]
        self.prs = Presentation()
        self.prs.slide_width = Inches(SLIDE_W)
        self.prs.slide_height = Inches(SLIDE_H)
        self.total = len(spec["slides"])

    # ---- primitives -------------------------------------------------------
    def rgb(self, key: str) -> RGBColor:
        return RGBColor.from_string(self.t[key])

    def new_slide(self):
        slide = self.prs.slides.add_slide(self.prs.slide_layouts[6])
        fill = slide.background.fill
        fill.solid()
        fill.fore_color.rgb = self.rgb("background")
        return slide

    def text(self, slide, x, y, w, h, paras, size=20, color="ink", bold=False,
             font=None, align=PP_ALIGN.LEFT, space_after=10, anchor=MSO_ANCHOR.TOP):
        box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        tf = box.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = anchor
        tf.margin_left = tf.margin_right = Inches(0)
        tf.margin_top = tf.margin_bottom = Inches(0)
        if isinstance(paras, str):
            paras = [paras]
        for i, line in enumerate(paras):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.alignment = align
            p.space_after = Pt(space_after)
            run = p.add_run()
            run.text = line
            run.font.size = Pt(size)
            run.font.bold = bold
            run.font.name = font or self.t["font"]
            run.font.color.rgb = self.rgb(color)
        return box

    def picture(self, slide, path, x, y, w=None, h=None, crop=None, border=True):
        """Place an image by width or height; crop = [left, top, right, bottom] as fractions."""
        full = ROOT / path
        l, t, r, b = crop or (0, 0, 0, 0)
        with Image.open(full) as im:
            ratio = (im.height * (1 - t - b)) / (im.width * (1 - l - r))
        if w is None:
            w = h / ratio
        h = w * ratio
        pic = slide.shapes.add_picture(str(full), Inches(x), Inches(y), width=Inches(w), height=Inches(h))
        pic.crop_left, pic.crop_top, pic.crop_right, pic.crop_bottom = l, t, r, b
        if border:
            pic.line.color.rgb = self.rgb("rule")
            pic.line.width = Pt(0.75)
        return w, h

    def header(self, slide, title, tag=None, number=None):
        self.text(slide, MARGIN, 0.45, 9.6, 0.9, title, size=32, bold=True)
        if tag:
            tw = 0.16 * len(tag) * 0.62 + 0.4
            shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(SLIDE_W - MARGIN - tw),
                                           Inches(0.5), Inches(tw), Inches(0.36))
            shape.fill.solid()
            shape.fill.fore_color.rgb = self.rgb("tag_fill")
            shape.line.fill.background()
            tf = shape.text_frame
            tf.margin_left = tf.margin_right = Inches(0.08)
            tf.margin_top = tf.margin_bottom = Inches(0)
            p = tf.paragraphs[0]
            p.alignment = PP_ALIGN.CENTER
            run = p.add_run()
            run.text = tag
            run.font.size = Pt(11)
            run.font.name = self.t["font"]
            run.font.color.rgb = self.rgb("accent")
        line = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(MARGIN), Inches(1.3),
                                          Inches(SLIDE_W - MARGIN), Inches(1.3))
        line.line.color.rgb = self.rgb("rule")
        line.line.width = Pt(1)
        mark = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(MARGIN), Inches(1.27), Inches(1.1), Inches(0.06))
        mark.fill.solid()
        mark.fill.fore_color.rgb = self.rgb("accent")
        mark.line.fill.background()
        if number:
            self.footer(slide, number)

    def footer(self, slide, number):
        self.text(slide, MARGIN, SLIDE_H - 0.45, 8, 0.3, self.spec["footer"], size=10, color="muted")
        self.text(slide, SLIDE_W - MARGIN - 1.5, SLIDE_H - 0.45, 1.5, 0.3, f"{number} / {self.total}",
                  size=10, color="muted", align=PP_ALIGN.RIGHT)

    def box(self, slide, x, y, w, h, label, strong=False):
        shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
        shape.adjustments[0] = 0.12
        shape.fill.solid()
        shape.fill.fore_color.rgb = self.rgb("tag_fill" if strong else "card")
        shape.line.color.rgb = self.rgb("accent" if strong else "muted")
        shape.line.width = Pt(1.5)
        tf = shape.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        for i, part in enumerate(label.split("\n")):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.alignment = PP_ALIGN.CENTER
            run = p.add_run()
            run.text = part
            run.font.size = Pt(15 if i == 0 else 12)
            run.font.bold = i == 0
            run.font.name = self.t["font"]
            run.font.color.rgb = self.rgb("ink" if i == 0 else "muted")
        return shape

    def card(self, slide, x, y, w, h, fill="card", marker=True):
        """A rounded panel; with a marker it carries a thin accent bar on its left edge."""
        shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
        shape.adjustments[0] = min(0.12, 0.08 / h)
        shape.fill.solid()
        shape.fill.fore_color.rgb = self.rgb(fill)
        shape.line.color.rgb = self.rgb("rule")
        shape.line.width = Pt(0.75)
        if marker:
            bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x + 0.16), Inches(y + 0.2), Inches(0.05), Inches(h - 0.4))
            bar.fill.solid()
            bar.fill.fore_color.rgb = self.rgb("accent")
            bar.line.fill.background()
        return shape

    def cards(self, slide, paras, x, y, w, size=20, per_line=None, gap=0.14):
        """One card per paragraph, stacked; the height follows the estimated number of lines."""
        per_line = per_line or int((w - 0.9) * 72 / (size * 0.46))
        line_h = size * 1.28 / 72
        for para in paras:
            lines = -(-len(para) // per_line)
            h = 0.42 + lines * line_h
            self.card(slide, x, y, w, h)
            self.text(slide, x + 0.42, y + 0.2, w - 0.7, h - 0.3, para, size=size, space_after=0)
            y += h + gap
        return y

    def stats(self, slide, items, y, h=1.05):
        """A row of tiles: a large value with a small label under it."""
        gap = 0.2
        w = (SLIDE_W - 2 * MARGIN - gap * (len(items) - 1)) / len(items)
        for i, item in enumerate(items):
            x = MARGIN + i * (w + gap)
            self.card(slide, x, y, w, h, marker=False)
            self.text(slide, x + 0.25, y + 0.14, w - 0.5, 0.5, item["value"], size=26, bold=True, color="accent")
            self.text(slide, x + 0.25, y + 0.66, w - 0.5, 0.3, item["label"], size=12, color="muted")

    # ---- layouts ----------------------------------------------------------
    def layout_title(self, s, n):
        slide = self.new_slide()
        bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(0.18), Inches(SLIDE_H))
        bar.fill.solid()
        bar.fill.fore_color.rgb = self.rgb("accent")
        bar.line.fill.background()
        self.text(slide, MARGIN, 1.6, 4.9, 1.6, s["title"], size=38, bold=True)
        self.text(slide, MARGIN, 3.2, 4.7, 1.3, s["subtitle"], size=20, color="ink")
        self.text(slide, MARGIN, 4.9, 4.9, 1.6, s["lines"], size=13, color="muted", space_after=6)
        self.picture(slide, s["image"], 5.75, 1.2, w=SLIDE_W - 5.75 - 0.4, crop=s.get("crop"))

    def layout_text(self, s, n):
        slide = self.new_slide()
        self.header(slide, s["title"], s.get("tag"), n)
        end = self.cards(slide, s["body"], MARGIN, 1.7, SLIDE_W - 2 * MARGIN, size=s.get("size", 21))
        if s.get("stats"):
            self.stats(slide, s["stats"], end + 0.08, h=0.98)

    def layout_images(self, s, n):
        """Body on top, a row of images of equal height below, centred."""
        slide = self.new_slide()
        self.header(slide, s["title"], s.get("tag"), n)
        self.text(slide, MARGIN, 1.6, SLIDE_W - 2 * MARGIN, 1.3, s["body"], size=19, space_after=8)
        imgs, gap, top = s["images"], 0.35, 2.95
        h = s.get("image_height", 3.6)
        widths = []
        for img in imgs:
            l, t, r, b = img.get("crop") or (0, 0, 0, 0)
            with Image.open(ROOT / img["path"]) as im:
                widths.append(h * (im.width * (1 - l - r)) / (im.height * (1 - t - b)))
        x = (SLIDE_W - sum(widths) - gap * (len(imgs) - 1)) / 2
        for img, w in zip(imgs, widths):
            self.picture(slide, img["path"], x, top, h=h, crop=img.get("crop"))
            self.text(slide, x, top + h + 0.1, w, 0.3, img["caption"], size=12, color="muted")
            x += w + gap

    def layout_stack(self, s, n):
        """Body on the left, image strips stacked on the right, each with a caption above."""
        slide = self.new_slide()
        self.header(slide, s["title"], s.get("tag"), n)
        self.text(slide, MARGIN, 1.75, 4.9, 5.0, s["body"], size=19, space_after=16)
        x, y = 5.9, 1.75
        w = SLIDE_W - x - MARGIN
        for img in s["images"]:
            self.text(slide, x, y, w, 0.3, img["caption"], size=13, color="muted", bold=True)
            _, h = self.picture(slide, img["path"], x, y + 0.35, w=w, crop=img.get("crop"))
            y += 0.35 + h + 0.45

    def layout_diagram(self, s, n):
        slide = self.new_slide()
        self.header(slide, s["title"], s.get("tag"), n)
        self.text(slide, MARGIN, 1.75, 5.6, 5.0, s["body"], size=19, space_after=16)
        ox, oy = 6.9, 1.75
        shapes = {}
        for node in s["nodes"]:
            shapes[node["id"]] = (node, self.box(slide, ox + node["x"], oy + node["y"], node["w"], node["h"],
                                                 node["label"], node.get("strong", False)))
        for edge in s["edges"]:
            a, _ = shapes[edge["from"]]
            b, _ = shapes[edge["to"]]
            x1 = ox + a["x"] + a["w"] / 2
            y1 = oy + a["y"] + a["h"]
            x2 = min(max(x1, ox + b["x"] + 0.3), ox + b["x"] + b["w"] - 0.3)
            y2 = oy + b["y"]
            conn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
            conn.line.color.rgb = self.rgb("muted")
            conn.line.width = Pt(1.5)
            end = conn.line._get_or_add_ln()
            tail = end.makeelement("{http://schemas.openxmlformats.org/drawingml/2006/main}tailEnd",
                                   {"type": "triangle", "w": "med", "len": "med"})
            end.append(tail)
            if edge.get("label"):
                self.text(slide, x2 + 0.15, (y1 + y2) / 2 - 0.15, 2.4, 0.3, edge["label"], size=12, color="accent",
                          font=self.t["mono"])

    def layout_code(self, s, n):
        slide = self.new_slide()
        self.header(slide, s["title"], s.get("tag"), n)
        self.text(slide, MARGIN, 1.75, 5.4, 5.0, s["body"], size=19, space_after=16)
        x, y, w, h = 6.4, 1.75, SLIDE_W - 6.4 - MARGIN, 3.9
        panel = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
        panel.fill.solid()
        panel.fill.fore_color.rgb = self.rgb("panel")
        panel.line.fill.background()
        lines = s["code"].rstrip("\n").split("\n")
        self.text(slide, x + 0.3, y + 0.3, w - 0.6, h - 0.6, lines, size=13, color="panel_ink",
                  font=self.t["mono"], space_after=2)
        self.text(slide, x, y + h + 0.12, w, 0.3, s["code_caption"], size=12, color="muted")

    def layout_table(self, s, n):
        slide = self.new_slide()
        self.header(slide, s["title"], s.get("tag"), n)
        rows, cols = len(s["rows"]) + 1, len(s["columns"])
        width = sum(s["widths"])
        row_h = 0.95
        gt = slide.shapes.add_table(rows, cols, Inches(MARGIN), Inches(1.75), Inches(width), Inches(row_h * rows))
        table = gt.table
        for c, cw in enumerate(s["widths"]):
            table.columns[c].width = Inches(cw)
        for r in range(rows):
            table.rows[r].height = Inches(0.6 if r == 0 else row_h)
            values = s["columns"] if r == 0 else s["rows"][r - 1]
            for c in range(cols):
                cell = table.cell(r, c)
                cell.fill.solid()
                cell.fill.fore_color.rgb = self.rgb("tag_fill" if r == 0 else "card")
                cell.vertical_anchor = MSO_ANCHOR.MIDDLE
                cell.margin_left = cell.margin_right = Inches(0.15)
                tf = cell.text_frame
                tf.word_wrap = True
                p = tf.paragraphs[0]
                run = p.add_run()
                run.text = values[c]
                run.font.name = self.t["font"]
                run.font.size = Pt(14 if r == 0 else 17)
                run.font.bold = r == 0 or c == 0
                run.font.color.rgb = self.rgb("accent" if r == 0 else "ink")
        if s.get("note"):
            self.text(slide, MARGIN, 1.75 + 0.6 + row_h * (rows - 1) + 0.3, 11, 0.4, s["note"], size=13, color="muted")

    def layout_end(self, s, n):
        slide = self.new_slide()
        bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(0.18), Inches(SLIDE_H))
        bar.fill.solid()
        bar.fill.fore_color.rgb = self.rgb("accent")
        bar.line.fill.background()
        self.text(slide, MARGIN, 2.5, 11, 1.2, s["title"], size=44, bold=True)
        self.text(slide, MARGIN, 3.8, 11, 1.4, s["lines"], size=22, space_after=10)

    def build(self) -> Path:
        for i, s in enumerate(self.spec["slides"], start=1):
            getattr(self, f"layout_{s['layout']}")(s, i)
        out = ROOT / self.spec["output"]
        self.prs.save(out)
        return out


def main(argv: list[str]) -> int:
    spec_path = ROOT / (argv[1] if len(argv) > 1 else "deck/slides.yaml")
    spec = yaml.safe_load(spec_path.read_text(encoding="utf-8"))
    out = Deck(spec).build()
    print(f"{out.relative_to(ROOT)}: {len(spec['slides'])} slides, {out.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
