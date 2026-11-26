#!/usr/bin/env python3
"""Fill the supplied 90-page OJT logbook template from the accompanying Markdown.

Install dependencies with: python3 -m pip install pypdf reportlab
Run: python3 fill_anvilmark_ojt.py "OJT Logbook.pdf" anvilmark-ojt-content.md output.pdf
Use --require-complete to reject unconfirmed activity or a missing designation.
"""

import argparse
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
import re
from tempfile import NamedTemporaryFile

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas


PAGE_COUNT = 90
LEARNER_PAGE = 2
CONTACTS_PAGE = 5
FIRST_JOURNAL_PAGE = 7
FEEDBACK_DIVIDER = 82
EXPECTED_SIZE = (594.96, 842.25)
DRAFT_PREFIX = "Draft for confirmation"
DATE_FORMAT = "%d/%m/%Y"
SECTION_HEADINGS = (
    "MY SPACE (My thoughts / My Sketch / My Notes / Things to Remember)",
    "Tasks Carried Out Today",
    "Key Learnings/Observations",
    "Tools, Equipment, Technology or Techniques Used",
    "Special Achievements",
)
JOURNAL_BOXES = (
    (54, 193, 487, 127),
    (54, 387, 487, 87),
    (54, 545, 487, 43),
    (54, 670, 253, 93),
    (327, 670, 214, 93),
)
CONTACT_KEYS = ("Academic Faculty", "Direct Supervisor", "HR", "Grievance")


def read_date(value):
    return datetime.strptime(value, DATE_FORMAT).date()


def parse_markdown(path):
    source = path.read_text(encoding="utf-8")
    source = re.sub(r"<!--.*?-->", "", source, flags=re.DOTALL)
    header, *blocks = re.split(
        r"^### DAILY ACTIVITY JOURNAL - Day \d+\s*$", source, flags=re.MULTILINE
    )
    details = dict(re.findall(r"^\*\*([^*]+):\*\*[ \t]*(.*?)$", header, re.MULTILINE))
    start = read_date(details["OJT Start Date"])
    cutoff = read_date(details["Journal Through"])
    end_value = details.get("OJT End Date")
    if end_value and read_date(end_value) < cutoff:
        raise ValueError("OJT End Date cannot precede Journal Through.")
    if cutoff < start:
        raise ValueError("Journal Through cannot precede OJT Start Date.")
    excluded = {
        read_date(value.strip())
        for value in details.get("Excluded Dates", "").split(",")
        if value.strip()
    }
    expected_dates = []
    for offset in range((cutoff - start).days + 1):
        day = start + timedelta(days=offset)
        if day.weekday() != 6 and day not in excluded:
            expected_dates.append(day)

    entries = []
    headings = "|".join(re.escape(title) for title in SECTION_HEADINGS)
    for block in blocks:
        pieces = re.split(rf"^\*\*({headings})\*\*[ \t]*$", block, flags=re.MULTILINE)
        date_match = re.search(r"^\*\*Date:\*\*[ \t]*(\S+)[ \t]*$", pieces[0], re.MULTILINE)
        if not date_match or tuple(pieces[1::2]) != SECTION_HEADINGS:
            raise ValueError("Each journal section needs its date and all five headings in order.")
        day = read_date(date_match[1])
        fields = [re.sub(r"\n---\s*$", "", part).strip() for part in pieces[2::2]]
        entries.append((day, fields))

    if [day for day, _ in entries] != expected_dates:
        raise ValueError("Journal dates must match the Monday–Saturday schedule after exclusions, in order.")
    if len(entries) > FEEDBACK_DIVIDER - FIRST_JOURNAL_PAGE:
        raise ValueError("The journal exceeds the capacity of the supplied template.")
    return details, entries


def date_label(day):
    return f"{day.day} {day:%B %Y}"


def single_line(canvas, page_height, value, x, baseline, width, size=10):
    if not value:
        return
    font = "Helvetica"
    while stringWidth(value, font, size) > width and size > 7:
        size -= 0.25
    if stringWidth(value, font, size) > width:
        raise ValueError(f"Value does not fit its template field: {value}")
    canvas.setFont(font, size)
    canvas.drawString(x, page_height - baseline, value)


def wrap_text(value, width, font, size):
    lines = []
    for paragraph in value.splitlines():
        line = ""
        for word in paragraph.split():
            candidate = f"{line} {word}" if line else word
            if stringWidth(candidate, font, size) <= width:
                line = candidate
                continue
            if stringWidth(word, font, size) > width:
                raise ValueError(f"Word is too wide for its journal field: {word}")
            lines.append(line)
            line = word
        lines.append(line)
    return lines


def text_box(canvas, page_height, value, bounds, label):
    if not value:
        return
    x, baseline, width, height = bounds
    font = "Helvetica-Oblique" if value.startswith(DRAFT_PREFIX) else "Helvetica"
    for size in (10.5, 10, 9.5, 9):
        lines = wrap_text(value, width, font, size)
        leading = size * 1.28
        if (len(lines) - 1) * leading + 3 <= height:
            break
    else:
        raise ValueError(f"{label} exceeds its journal box. Shorten the entry.")
    canvas.saveState()
    canvas.setFont(font, size)
    if value.startswith(DRAFT_PREFIX):
        canvas.setFillColor(colors.HexColor("#535c65"))
    for index, line in enumerate(lines):
        canvas.drawString(x, page_height - baseline - index * leading, line)
    canvas.restoreState()


def draw_learner(canvas, height, details):
    fields = (
        ("Learner’s Name", 164, 558.5, 330),
        ("Registration No.", 164, 588.5, 145),
        ("Program Name", 159, 618.5, 335),
        ("Semester", 134, 648.5, 63),
        ("Location", 254, 648.5, 237),
        ("Industry Partner", 195, 679, 295),
        ("Phone No.", 119, 760, 132),
        ("Email", 295, 760, 155),
    )
    for key, x, baseline, width in fields:
        single_line(canvas, height, details.get(key, ""), x, baseline, width)
    single_line(canvas, height, date_label(read_date(details["OJT Start Date"])), 372, 588.5, 120)
    # There is no preprinted end-date field. The last row inside the learner
    # details box has room for a short, separately labeled line.
    end = details.get("OJT End Date", "")
    end_label = date_label(read_date(end)) if end else "Pending allotted final external viva date"
    single_line(canvas, height, f"OJT End Date: {end_label}", 80, 699, 193, size=8.5)
    project, track = details.get("Project"), details.get("Project Track")
    if project and track:
        single_line(canvas, height, f"Project: {project} ({track})", 281, 699, 212, size=8.5)


def draw_contacts(canvas, height, details):
    for key, baseline in zip(CONTACT_KEYS, (626, 669, 712, 754)):
        single_line(canvas, height, details.get(f"{key} Phone", ""), 162, baseline, 115)
        single_line(canvas, height, details.get(f"{key} Email", ""), 327, baseline, 193)


def draw_journal(canvas, height, details, entry):
    day, fields = entry
    timing = re.fullmatch(r"Monday to Saturday, (.+?)\s*[–-]\s*(.+)", details["OJT Timings"])
    if not timing:
        raise ValueError("OJT Timings must use: Monday to Saturday, 9:30 AM – 7:30 PM")
    for value, x, baseline, width in (
        (date_label(day), 88, 97.5, 183),
        (timing[1], 379, 97.5, 65),
        (timing[2], 473, 97.5, 65),
        (details["Department"], 129, 123.5, 151),
        (details.get("Designation", ""), 383, 123.5, 153),
    ):
        single_line(canvas, height, value, x, baseline, width)
    for value, bounds, label in zip(fields, JOURNAL_BOXES, SECTION_HEADINGS):
        text_box(canvas, height, value, bounds, f"{day:%d/%m/%Y} — {label}")


def overlay(page, draw, *args):
    width, height = float(page.mediabox.width), float(page.mediabox.height)
    if page.rotation or any(abs(a - b) > 1 for a, b in zip((width, height), EXPECTED_SIZE)):
        raise ValueError("An overlay page does not match the supplied portrait A4 template.")
    with BytesIO() as buffer:
        canvas = Canvas(buffer, pagesize=(width, height), pageCompression=1)
        draw(canvas, height, *args)
        canvas.showPage()
        canvas.save()
        buffer.seek(0)
        page.merge_page(PdfReader(buffer).pages[0])
    page.compress_content_streams()


def fill(template, contents, output, require_complete):
    if output.resolve() in (template.resolve(), contents.resolve()):
        raise ValueError("Output must be a different file from the template and Markdown.")
    details, entries = parse_markdown(contents)
    pending = sum(
        any(not field or field.startswith(DRAFT_PREFIX) for field in fields)
        for _, fields in entries
    )
    designation_missing = not details.get("Designation")
    if require_complete and (pending or designation_missing):
        raise ValueError(
            f"{pending} journal entries need review. Designation missing: {designation_missing}."
        )
    with template.open("rb") as file:
        reader = PdfReader(file)
        if len(reader.pages) != PAGE_COUNT or "Learner" not in (reader.pages[LEARNER_PAGE].extract_text() or ""):
            raise ValueError("Use the original 90-page OJT Logbook template.")
        writer = PdfWriter(clone_from=reader)
        writer.add_metadata({"/Title": f"{details.get('Project', 'OJT')} OJT Logbook"})
        overlay(writer.pages[LEARNER_PAGE], draw_learner, details)
        if any(details.get(f"{key} {field}") for key in CONTACT_KEYS for field in ("Phone", "Email")):
            overlay(writer.pages[CONTACTS_PAGE], draw_contacts, details)
        for index, entry in enumerate(entries, FIRST_JOURNAL_PAGE):
            overlay(writer.pages[index], draw_journal, details, entry)
        with NamedTemporaryFile(dir=output.parent, suffix=".pdf", delete=False) as tmp:
            temp_path = Path(tmp.name)
            try:
                writer.write(tmp)
                tmp.close()
                temp_path.replace(output)
            finally:
                temp_path.unlink(missing_ok=True)
    print(f"Filled {len(entries)} journal pages. {pending} need review.")
    if designation_missing:
        print("Designation is blank.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("template", type=Path)
    parser.add_argument("contents", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()
    try:
        fill(args.template, args.contents, args.output, args.require_complete)
    except (KeyError, ValueError, OSError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
