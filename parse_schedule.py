# -*- coding: utf-8 -*-
"""Tải & parse lịch học Samsung ICTU từ Google Sheets → schedule.json"""
import csv
import json
import urllib.request
from collections import OrderedDict
from datetime import datetime
from pathlib import Path

SHEET_ID = "1nnYhUeWdgkSE8wZvagctTT28VT7nyTUd9e3gDi8m-4s"
GID = "1271431527"
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&gid={GID}"
OUT_DIR = Path(__file__).resolve().parent


def download_csv() -> str:
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    text = data.decode("utf-8-sig")
    (OUT_DIR / "schedule.csv").write_text(text, encoding="utf-8")
    return text


def parse_rows(text: str):
    reader = csv.reader(text.splitlines())
    rows = list(reader)
    if not rows:
        return []
    data = []
    for row in rows[1:]:
        while len(row) < 10:
            row.append("")
        data.append(
            {
                "so_tiet": (row[0] or "").strip(),
                "chu_de_ngay": (row[1] or "").strip(),
                "chu_de_tiet": (row[2] or "").strip(),
                "noi_dung": (row[3] or "").strip(),
                "tai_lieu": (row[4] or "").strip(),
                "type": (row[5] or "").strip(),
                "date": (row[6] or "").strip(),
                "lecturer": (row[7] or "").strip(),
                "time": (row[8] or "").strip(),
                "classroom": (row[9] or "").strip(),
            }
        )
    return data


def parse_date(d: str):
    d = (d or "").strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(d, fmt).date()
        except ValueError:
            continue
    return None


def build_lessons(rows):
    """
    Fill-down metadata theo pattern merge-cell của Google Sheets.
    Khi đổi 'Chủ đề theo ngày' mà không có ngày → đánh dấu chưa xếp lịch.
    """
    cur_date = ""
    cur_topic = ""
    cur_lec = ""
    cur_time = ""
    cur_room = ""
    cur_type = ""
    cur_mat = ""
    lessons = []

    for r in rows:
        topic = r["chu_de_ngay"]
        if topic and topic != cur_topic:
            if r["date"]:
                cur_date = r["date"]
            else:
                cur_date = ""
            cur_topic = topic
        elif r["date"]:
            cur_date = r["date"]

        if r["lecturer"]:
            cur_lec = r["lecturer"]
        if r["time"]:
            cur_time = r["time"]
        if r["classroom"]:
            cur_room = r["classroom"]
        if r["type"]:
            cur_type = r["type"]
        if r["tai_lieu"]:
            cur_mat = r["tai_lieu"]

        if not r["chu_de_tiet"] and not r["noi_dung"] and not r["so_tiet"]:
            continue
        # Bỏ dòng tổng kết số tiết rỗng
        if r["so_tiet"] and not r["chu_de_tiet"] and not r["noi_dung"]:
            continue

        lessons.append(
            {
                "so_tiet": r["so_tiet"],
                "day_topic": cur_topic,
                "lesson_topic": r["chu_de_tiet"],
                "content": r["noi_dung"],
                "material": cur_mat,
                "type": cur_type,
                "date": cur_date,
                "lecturer": cur_lec if cur_date else "",
                "time": cur_time if cur_date else "",
                "classroom": cur_room if cur_date else "",
                "scheduled": bool(cur_date),
            }
        )
    return lessons


def group_scheduled_days(lessons):
    days = OrderedDict()
    for les in lessons:
        if not les["scheduled"]:
            continue
        key = les["date"]
        if key not in days:
            days[key] = {
                "date": key,
                "date_iso": None,
                "weekday": None,
                "day_topic": les["day_topic"],
                "topics": [],
                "lecturer": les["lecturer"],
                "time": les["time"] or "18h00-21h00",
                "classroom": les["classroom"],
                "type": les["type"] or "Offline class",
                "material": les["material"],
                "lessons": [],
            }
        day = days[key]
        for field in ("lecturer", "time", "classroom", "type", "material"):
            if les.get(field):
                day[field] = les[field]
        if les["day_topic"] and les["day_topic"] not in day["topics"]:
            day["topics"].append(les["day_topic"])
            day["day_topic"] = " · ".join(day["topics"]) if len(day["topics"]) > 1 else day["topics"][0]
        if les["lesson_topic"] or les["content"]:
            day["lessons"].append(
                {
                    "so_tiet": les["so_tiet"],
                    "title": les["lesson_topic"],
                    "content": les["content"],
                    "module": les["day_topic"],
                }
            )

    WD = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"]
    result = []
    for day in days.values():
        dt = parse_date(day["date"])
        if dt:
            day["date_iso"] = dt.isoformat()
            day["weekday"] = WD[dt.weekday()]
            day["sort_key"] = dt.isoformat()
        else:
            day["sort_key"] = day["date"]
        result.append(day)
    result.sort(key=lambda x: x["sort_key"])
    return result


def group_unscheduled_modules(lessons):
    modules = OrderedDict()
    for les in lessons:
        if les["scheduled"]:
            continue
        key = les["day_topic"] or "Khác"
        if key not in modules:
            modules[key] = {
                "day_topic": key,
                "material": les["material"],
                "type": les["type"],
                "lessons": [],
            }
        mod = modules[key]
        if les["material"]:
            mod["material"] = les["material"]
        if les["lesson_topic"] or les["content"]:
            mod["lessons"].append(
                {
                    "so_tiet": les["so_tiet"],
                    "title": les["lesson_topic"],
                    "content": les["content"],
                }
            )
    return list(modules.values())


def build_weeks(days):
    weeks = OrderedDict()
    for day in days:
        if not day.get("date_iso"):
            key, label = "unknown", "Không xác định"
        else:
            dt = datetime.fromisoformat(day["date_iso"]).date()
            iso = dt.isocalendar()
            key = f"{iso.year}-W{iso.week:02d}"
            monday = datetime.fromisocalendar(iso.year, iso.week, 1).date()
            sunday = datetime.fromisocalendar(iso.year, iso.week, 7).date()
            label = f"Tuần {iso.week}: {monday.strftime('%d/%m')} – {sunday.strftime('%d/%m/%Y')}"
        if key not in weeks:
            weeks[key] = {"id": key, "label": label, "days": []}
        weeks[key]["days"].append(day)
    return list(weeks.values())


def main():
    print("Đang tải Google Sheet...")
    text = download_csv()
    rows = parse_rows(text)
    lessons = build_lessons(rows)
    days = group_scheduled_days(lessons)
    unscheduled = group_unscheduled_modules(lessons)
    weeks = build_weeks(days)

    print(f"Buổi đã xếp lịch: {len(days)}")
    for d in days:
        print(
            f"  {d['date']} ({d.get('weekday')}) | {d['time']} | {d['classroom']} | "
            f"{len(d['lessons'])} tiết | {d['day_topic'][:55]}"
        )
    print(f"Module chưa xếp lịch: {len(unscheduled)}")

    payload = {
        "course": "SIC2026 ICTU – Bản dẫn cơ bản No1",
        "source": f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit#gid={GID}",
        "sheet_id": SHEET_ID,
        "gid": GID,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "days": days,
        "weeks": weeks,
        "unscheduled": unscheduled,
        "stats": {
            "total_days": len(days),
            "total_lessons": sum(len(d["lessons"]) for d in days),
            "total_weeks": len(weeks),
            "unscheduled_modules": len(unscheduled),
            "unscheduled_lessons": sum(len(m["lessons"]) for m in unscheduled),
        },
    }
    out = OUT_DIR / "schedule.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Đã ghi {out}")
    return payload


if __name__ == "__main__":
    main()
