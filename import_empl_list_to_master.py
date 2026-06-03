import json
import re
import sys
import urllib.error
import urllib.request
from collections import OrderedDict

import openpyxl


WORKBOOK = r"E:\ODC\Empl list.xlsx"
API_URL = "http://localhost:5050/api/master-persons"


def clean_text(value):
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def title_name(value):
    text = clean_text(value).lower()
    parts = re.split(r"([ \-'.])", text)
    return "".join(part[:1].upper() + part[1:] if part and part not in " -'." else part for part in parts).strip()


def make_id(name):
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"head-{slug or 'group'}"


def main():
    wb = openpyxl.load_workbook(WORKBOOK, data_only=True)
    ws = wb.active

    groups = OrderedDict()
    for row in ws.iter_rows(min_row=2, values_only=True):
        code = clean_text(row[1])
        name = title_name(row[2])
        designation = clean_text(row[3])
        department = clean_text(row[4]) or "Unassigned"
        location = clean_text(row[5])
        if not name:
            continue

        bucket = groups.setdefault(department, [])
        person = {
            "name": name,
            "code": code,
            "designation": designation,
            "department": department,
            "location": location,
        }
        bucket.append(person)

    used_ids = set()
    heads = []
    for department, persons in groups.items():
        base_id = make_id(department)
        group_id = base_id
        suffix = 2
        while group_id in used_ids:
            group_id = f"{base_id}-{suffix}"
            suffix += 1
        used_ids.add(group_id)
        heads.append({"id": group_id, "name": department, "persons": persons})

    if not heads:
        print("No employee rows found in workbook.", file=sys.stderr)
        return 1

    body = json.dumps(heads).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.load(resp)
    except urllib.error.URLError as exc:
        print(f"Failed to update Master Persons: {exc}", file=sys.stderr)
        return 1

    print(f"Imported {len(heads)} department groups into Master Persons.")
    for head in heads[:20]:
        print(f"- {head['name']}: {len(head['persons'])} person(s)")
    if len(heads) > 20:
        print(f"- ...and {len(heads) - 20} more group(s)")
    print(f"Server returned {len(payload)} groups.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
