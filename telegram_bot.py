# -*- coding: utf-8 -*-
"""
Bot Telegram – thông báo lịch học SIC2026 ICTU.

Lịch gửi (múi giờ Việt Nam Asia/Ho_Chi_Minh):
  • 08:00 sáng  – ngày có buổi học
  • Trước giờ học 2 tiếng (vd. 16:00 nếu học 18:00)

Lệnh bot:
  /start   – đăng ký nhận thông báo
  /stop    – hủy đăng ký
  /today   – lịch hôm nay
  /next    – buổi sắp tới
  /week    – lịch tuần này
  /sync    – tải lại Google Sheet
  /test    – gửi thử thông báo
  /status  – trạng thái bot
  /help    – trợ giúp
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    from backports.zoneinfo import ZoneInfo  # type: ignore

ROOT = Path(__file__).resolve().parent
TZ = ZoneInfo("Asia/Ho_Chi_Minh")
SCHEDULE_JSON = ROOT / "schedule.json"
SUBSCRIBERS_FILE = ROOT / "subscribers.json"
SENT_LOG_FILE = ROOT / "sent_notifications.json"
ENV_FILE = ROOT / ".env"

# Mặc định: nhắc trước 2 giờ; sáng lúc 08:00; Chủ nhật gửi lịch tuần
MORNING_HOUR = 8
MORNING_MINUTE = 0
PRECLASS_HOURS = 2
# Trước khi gửi tin: luôn sync Sheet (lịch CN + đổi đến trước 2h)
SYNC_BEFORE_NOTIFY = True
POLL_SECONDS = 20
SYNC_INTERVAL_HOURS = 1  # nền: sync thường xuyên hơn
API_BASE = "https://api.telegram.org"
POLICY_NOTE = (
    "📌 <i>Lịch cập nhật mỗi <b>Chủ nhật</b>; có thể đổi đến trước giờ học "
    "<b>2 tiếng</b>. Bot luôn lấy bản mới nhất từ Sheet.</i>"
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("lich-hoc-bot")


# ─────────────────────────── config ───────────────────────────

def load_dotenv(path: Path = ENV_FILE) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def get_token() -> str:
    load_dotenv()
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token or token.startswith("YOUR_"):
        raise SystemExit(
            "Chưa cấu hình TELEGRAM_BOT_TOKEN.\n"
            "1) Chat @BotFather trên Telegram → /newbot → copy token\n"
            "2) Tạo file .env từ env.example và dán token\n"
            "   TELEGRAM_BOT_TOKEN=123456:ABC-DEF..."
        )
    return token


def bootstrap_chat_ids() -> List[str]:
    """Chat ID cố định trong .env (tùy chọn)."""
    load_dotenv()
    raw = (os.environ.get("TELEGRAM_CHAT_IDS") or "").strip()
    if not raw:
        return []
    return [x.strip() for x in raw.replace(";", ",").split(",") if x.strip()]


# ─────────────────────────── persistence ───────────────────────────

def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_subscribers() -> Set[str]:
    data = load_json(SUBSCRIBERS_FILE, {"chats": []})
    chats = set(str(c) for c in data.get("chats", []))
    for c in bootstrap_chat_ids():
        chats.add(str(c))
    return chats


def save_subscribers(chats: Set[str]) -> None:
    save_json(SUBSCRIBERS_FILE, {"chats": sorted(chats), "updated_at": now_vn().isoformat(timespec="seconds")})


def load_sent() -> Dict[str, List[str]]:
    """{ '2026-07-21': ['morning', 'preclass'] }"""
    return load_json(SENT_LOG_FILE, {})


def mark_sent(day_key: str, kind: str) -> None:
    sent = load_sent()
    kinds = set(sent.get(day_key, []))
    kinds.add(kind)
    sent[day_key] = sorted(kinds)
    # giữ 60 ngày gần nhất
    if len(sent) > 60:
        for k in sorted(sent.keys())[:-60]:
            sent.pop(k, None)
    save_json(SENT_LOG_FILE, sent)


def already_sent(day_key: str, kind: str) -> bool:
    return kind in load_sent().get(day_key, [])


# ─────────────────────────── time helpers ───────────────────────────

def now_vn() -> datetime:
    return datetime.now(TZ)


def parse_date_iso(day: Dict[str, Any]) -> Optional[date]:
    iso = day.get("date_iso")
    if iso:
        try:
            return date.fromisoformat(iso)
        except ValueError:
            pass
    raw = day.get("date") or ""
    m = re.match(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", raw.strip())
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return date(y, mo, d)
    return None


def parse_start_time(time_str: str) -> tuple:
    """'18h00-21h00' → (18, 0)"""
    m = re.search(r"(\d{1,2})[h:](\d{2})", str(time_str or ""), re.I)
    if not m:
        return 18, 0
    return int(m.group(1)), int(m.group(2))


def class_start_dt(day: Dict[str, Any]) -> Optional[datetime]:
    d = parse_date_iso(day)
    if not d:
        return None
    h, mi = parse_start_time(day.get("time") or "")
    return datetime(d.year, d.month, d.day, h, mi, 0, tzinfo=TZ)


def day_key(day: Dict[str, Any]) -> str:
    d = parse_date_iso(day)
    return d.isoformat() if d else str(day.get("date"))


# ─────────────────────────── schedule data ───────────────────────────

def load_schedule() -> Dict[str, Any]:
    if not SCHEDULE_JSON.exists():
        refresh_schedule()
    return load_json(SCHEDULE_JSON, {"days": [], "weeks": [], "course": "SIC2026"})


def refresh_schedule() -> Dict[str, Any]:
    log.info("Đồng bộ lịch từ Google Sheet...")
    sys.path.insert(0, str(ROOT))
    import parse_schedule  # noqa: WPS433

    payload = parse_schedule.main()
    log.info(
        "Đã sync: %s buổi xếp lịch",
        payload.get("stats", {}).get("total_days", 0),
    )
    return payload


def today_classes(data: Dict[str, Any], on: Optional[date] = None) -> List[Dict[str, Any]]:
    on = on or now_vn().date()
    out = []
    for day in data.get("days") or []:
        d = parse_date_iso(day)
        if d == on:
            out.append(day)
    return out


def next_class(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    now = now_vn()
    candidates = []
    for day in data.get("days") or []:
        start = class_start_dt(day)
        if start and start >= now - timedelta(hours=3):  # còn đang học cũng tính gần
            # ưu tiên buổi chưa kết thúc
            end_h = 21
            m = re.search(r"-(\d{1,2})[h:](\d{2})", str(day.get("time") or ""), re.I)
            if m:
                end_h = int(m.group(1))
            end = start.replace(hour=end_h)
            if end >= now:
                candidates.append((start, day))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


def week_classes(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    today = now_vn().date()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    out = []
    for day in data.get("days") or []:
        d = parse_date_iso(day)
        if d and monday <= d <= sunday:
            out.append(day)
    return out


def target_week_range(on: Optional[date] = None):
    """Chủ nhật → tuần tới (T2–CN); các ngày khác → tuần hiện tại."""
    on = on or now_vn().date()
    if on.weekday() == 6:  # Sunday
        monday = on + timedelta(days=1)
        label = "tuần tới"
    else:
        monday = on - timedelta(days=on.weekday())
        label = "tuần này"
    sunday = monday + timedelta(days=6)
    return monday, sunday, label


def published_week_classes(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    monday, sunday, _ = target_week_range()
    out = []
    for day in data.get("days") or []:
        d = parse_date_iso(day)
        if d and monday <= d <= sunday:
            out.append(day)
    return out


# ─────────────────────────── Telegram API ───────────────────────────

class TelegramBot:
    def __init__(self, token: str):
        self.token = token
        self.offset = 0
        self.base = f"{API_BASE}/bot{token}"

    def _call(self, method: str, payload: Optional[dict] = None, timeout: int = 60) -> dict:
        url = f"{self.base}/{method}"
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", errors="replace")
            log.error("Telegram HTTP %s: %s", e.code, err[:300])
            raise
        if not body.get("ok"):
            raise RuntimeError(f"Telegram API error: {body}")
        return body

    def get_me(self) -> dict:
        return self._call("getMe")["result"]

    def send_message(
        self,
        chat_id: str,
        text: str,
        parse_mode: str = "HTML",
        disable_preview: bool = True,
    ) -> bool:
        try:
            self._call(
                "sendMessage",
                {
                    "chat_id": chat_id,
                    "text": text,
                    "parse_mode": parse_mode,
                    "disable_web_page_preview": disable_preview,
                },
                timeout=30,
            )
            return True
        except Exception as e:
            log.error("Gửi tin nhắn tới %s thất bại: %s", chat_id, e)
            return False

    def broadcast(self, text: str, chats: Set[str]) -> int:
        ok = 0
        for cid in list(chats):
            if self.send_message(cid, text):
                ok += 1
        return ok

    def get_updates(self, timeout: int = 25) -> List[dict]:
        try:
            body = self._call(
                "getUpdates",
                {
                    "offset": self.offset,
                    "timeout": timeout,
                    "allowed_updates": ["message"],
                },
                timeout=timeout + 10,
            )
        except Exception as e:
            log.warning("getUpdates lỗi: %s", e)
            return []
        updates = body.get("result") or []
        if updates:
            self.offset = updates[-1]["update_id"] + 1
        return updates


# ─────────────────────────── message format ───────────────────────────

def esc(s: Any) -> str:
    return (
        str(s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def fmt_day_short(day: Dict[str, Any]) -> str:
    lessons = day.get("lessons") or []
    titles = []
    for les in lessons[:5]:
        t = (les.get("title") or "").strip()
        if t:
            titles.append(f"  • {esc(t)}")
    more = ""
    if len(lessons) > 5:
        more = f"\n  • … và {len(lessons) - 5} tiết nữa"
    body = "\n".join(titles) + more if titles else "  • (xem sheet để biết chi tiết)"
    return (
        f"📘 <b>{esc(day.get('day_topic'))}</b>\n"
        f"📅 {esc(day.get('weekday'))} · {esc(day.get('date'))}\n"
        f"⏰ {esc(day.get('time') or '18h00-21h00')}\n"
        f"📍 Phòng <b>{esc(day.get('classroom') or '—')}</b>\n"
        f"👤 {esc(day.get('lecturer') or '—')}\n"
        f"🏷 {esc(day.get('type') or 'Offline class')}\n"
        f"📎 {esc(day.get('material') or 'Slide bài giảng')}\n\n"
        f"<b>Nội dung ({len(lessons)} tiết):</b>\n{body}"
    )


def msg_morning(day: Dict[str, Any], course: str) -> str:
    return (
        f"☀️ <b>Chào buổi sáng – Hôm nay có lịch học!</b>\n"
        f"<i>{esc(course)}</i>\n\n"
        f"{fmt_day_short(day)}\n\n"
        f"💡 Nhắc lại trước giờ học <b>2 tiếng</b> (lịch chốt lần cuối).\n"
        f"{POLICY_NOTE}\n"
        f"Gõ /today hoặc /next để xem lại."
    )


def msg_preclass(day: Dict[str, Any], course: str) -> str:
    start = class_start_dt(day)
    hhmm = start.strftime("%H:%M") if start else (day.get("time") or "")
    return (
        f"⏰ <b>Sắp đến giờ học (còn ~{PRECLASS_HOURS} giờ)</b>\n"
        f"<i>{esc(course)}</i>\n\n"
        f"🔄 <b>Lịch mới nhất từ Sheet</b> (đã qua thời điểm có thể đổi lịch)\n"
        f"Bắt đầu lúc <b>{esc(hhmm)}</b>\n\n"
        f"{fmt_day_short(day)}\n\n"
        f"🎒 Kiểm tra lại <b>phòng · giờ · giảng viên</b> rồi di chuyển tới lớp nhé!"
    )


def msg_weekly_update(days: List[Dict[str, Any]], course: str) -> str:
    monday, sunday, label = target_week_range()
    mon_s = monday.strftime("%d/%m/%Y")
    sun_s = sunday.strftime("%d/%m/%Y")
    if not days:
        return (
            f"🗓 <b>Cập nhật lịch học {label}</b>\n"
            f"<i>{esc(course)}</i>\n\n"
            f"📅 {esc(mon_s)} → {esc(sun_s)}\n\n"
            f"📭 Chưa có buổi nào được xếp trên Sheet.\n\n"
            f"{POLICY_NOTE}"
        )
    lines = []
    for d in days:
        lines.append(
            f"• <b>{esc(d.get('date'))}</b> ({esc(d.get('weekday'))}) "
            f"{esc(d.get('time'))} · 📍 {esc(d.get('classroom') or '—')}\n"
            f"  {esc(d.get('day_topic'))}\n"
            f"  👤 {esc(d.get('lecturer') or '—')}"
        )
    return (
        f"🗓 <b>Lịch học {label} đã cập nhật</b>\n"
        f"<i>{esc(course)}</i>\n\n"
        f"📅 {esc(mon_s)} → {esc(sun_s)} · <b>{len(days)}</b> buổi\n\n"
        + "\n\n".join(lines)
        + f"\n\n☀️ Nhắc 08:00 sáng ngày có học\n"
        f"⏰ Nhắc trước giờ học 2 tiếng (bản chốt)\n\n"
        f"{POLICY_NOTE}"
    )


def msg_preclass_cancelled(course: str, date_label: str) -> str:
    return (
        f"⚠️ <b>Không còn lịch học hôm nay trên Sheet</b>\n"
        f"<i>{esc(course)}</i>\n\n"
        f"Ngày {esc(date_label)} hiện <b>không có</b> buổi đã xếp.\n"
        f"Có thể lớp đã <b>hủy / dời lịch</b> trước mốc 2 tiếng.\n\n"
        f"Gõ /next hoặc /week để kiểm tra.\n"
        f"{POLICY_NOTE}"
    )


def msg_today_none() -> str:
    return (
        "📭 Hôm nay <b>không có</b> buổi học trong lịch đã xếp.\n"
        "Gõ /next để xem buổi sắp tới.\n"
        f"{POLICY_NOTE}"
    )


def msg_help() -> str:
    return (
        "🤖 <b>Bot lịch học SIC2026</b>\n\n"
        "<b>Quy tắc lịch:</b>\n"
        "• Sheet cập nhật mỗi <b>Chủ nhật</b>\n"
        "• Có thể đổi đến trước giờ học <b>2 tiếng</b>\n"
        "• Mỗi lần báo → bot đọc Sheet mới nhất\n\n"
        "Tự động thông báo:\n"
        "• <b>Chủ nhật 08:00</b> – lịch tuần tới\n"
        f"• <b>08:00</b> sáng – ngày có học\n"
        f"• <b>Trước {PRECLASS_HOURS} giờ</b> – nhắc vào lớp (bản chốt)\n\n"
        "<b>Lệnh:</b>\n"
        "/start – đăng ký nhận thông báo\n"
        "/stop – hủy đăng ký\n"
        "/today – lịch hôm nay\n"
        "/next – buổi sắp tới\n"
        "/week – lịch tuần\n"
        "/sync – cập nhật từ Google Sheet\n"
        "/test – gửi thử thông báo\n"
        "/status – trạng thái bot\n"
        "/help – trợ giúp"
    )


# ─────────────────────────── command handlers ───────────────────────────

class App:
    def __init__(self):
        self.token = get_token()
        self.bot = TelegramBot(self.token)
        self.subscribers = load_subscribers()
        self.schedule = load_schedule()
        self.last_sync = now_vn()
        self.last_tick_minute: Optional[str] = None

    def ensure_synced(self, force: bool = False) -> None:
        age = now_vn() - self.last_sync
        if force or age >= timedelta(hours=SYNC_INTERVAL_HOURS) or not self.schedule.get("days"):
            try:
                self.schedule = refresh_schedule()
                self.last_sync = now_vn()
            except Exception as e:
                log.error("Sync thất bại: %s", e)
                self.schedule = load_schedule()

    def handle_update(self, upd: dict) -> None:
        msg = upd.get("message") or {}
        text = (msg.get("text") or "").strip()
        chat = msg.get("chat") or {}
        chat_id = str(chat.get("id") or "")
        if not chat_id or not text:
            return
        if not text.startswith("/"):
            self.bot.send_message(chat_id, "Gõ /help để xem lệnh. /start để đăng ký nhận lịch học.")
            return

        cmd = text.split()[0].split("@")[0].lower()
        course = self.schedule.get("course") or "SIC2026"

        if cmd == "/start":
            self.subscribers.add(chat_id)
            save_subscribers(self.subscribers)
            uname = chat.get("first_name") or chat.get("username") or chat_id
            self.bot.send_message(
                chat_id,
                f"👋 Xin chào <b>{esc(uname)}</b>!\n"
                f"Bạn đã <b>đăng ký</b> nhận thông báo lịch học.\n\n"
                f"Chat ID: <code>{esc(chat_id)}</code>\n\n"
                + msg_help(),
            )
            # gửi luôn buổi sắp tới
            nxt = next_class(self.schedule)
            if nxt:
                self.bot.send_message(chat_id, "📌 <b>Buổi học sắp tới:</b>\n\n" + fmt_day_short(nxt))

        elif cmd == "/stop":
            self.subscribers.discard(chat_id)
            save_subscribers(self.subscribers)
            self.bot.send_message(chat_id, "Đã hủy đăng ký thông báo. Gõ /start nếu muốn bật lại.")

        elif cmd == "/help":
            self.bot.send_message(chat_id, msg_help())

        elif cmd == "/today":
            days = today_classes(self.schedule)
            if not days:
                self.bot.send_message(chat_id, msg_today_none())
            else:
                for d in days:
                    self.bot.send_message(chat_id, "📅 <b>Lịch hôm nay</b>\n\n" + fmt_day_short(d))

        elif cmd == "/next":
            nxt = next_class(self.schedule)
            if not nxt:
                self.bot.send_message(chat_id, "Không còn buổi học nào trong lịch đã xếp.")
            else:
                self.bot.send_message(chat_id, "📌 <b>Buổi học sắp tới</b>\n\n" + fmt_day_short(nxt))

        elif cmd == "/week":
            self.ensure_synced(force=True)
            days = published_week_classes(self.schedule)
            self.bot.send_message(chat_id, msg_weekly_update(days, course))

        elif cmd == "/sync":
            self.bot.send_message(chat_id, "⏳ Đang đồng bộ Google Sheet...")
            try:
                self.ensure_synced(force=True)
                s = self.schedule.get("stats") or {}
                self.bot.send_message(
                    chat_id,
                    f"✅ Đã cập nhật từ Sheet.\n"
                    f"• Buổi xếp lịch: <b>{s.get('total_days', 0)}</b>\n"
                    f"• Module chờ lịch: <b>{s.get('unscheduled_modules', 0)}</b>\n"
                    f"• Lúc: {esc(self.schedule.get('updated_at'))}\n\n"
                    f"{POLICY_NOTE}",
                )
            except Exception as e:
                self.bot.send_message(chat_id, f"❌ Sync lỗi: {esc(e)}")

        elif cmd == "/test":
            self.ensure_synced(force=True)
            days = today_classes(self.schedule)
            day = days[0] if days else next_class(self.schedule)
            self.bot.send_message(
                chat_id,
                "🧪 <b>Test – lịch tuần</b>\n\n"
                + msg_weekly_update(published_week_classes(self.schedule), course),
            )
            if not day:
                self.bot.send_message(chat_id, "Không có buổi lẻ để test morning/preclass.")
            else:
                self.bot.send_message(chat_id, "🧪 <b>Test – thông báo sáng</b>\n\n" + msg_morning(day, course))
                self.bot.send_message(chat_id, "🧪 <b>Test – nhắc trước 2 giờ</b>\n\n" + msg_preclass(day, course))

        elif cmd == "/status":
            s = self.schedule.get("stats") or {}
            nxt = next_class(self.schedule)
            self.bot.send_message(
                chat_id,
                "📊 <b>Trạng thái bot</b>\n"
                f"• Giờ VN: <code>{now_vn().strftime('%Y-%m-%d %H:%M:%S %Z')}</code>\n"
                f"• Subscribers: <b>{len(self.subscribers)}</b>\n"
                f"• Buổi xếp lịch: <b>{s.get('total_days', 0)}</b>\n"
                f"• Sync gần nhất: {esc(self.schedule.get('updated_at'))}\n"
                f"• Buổi tới: {esc(nxt.get('date') if nxt else '—')} "
                f"{esc(nxt.get('time') if nxt else '')}\n"
                f"• Bạn đã đăng ký: <b>{'Có' if chat_id in self.subscribers else 'Chưa'}</b>\n"
                f"• Quy tắc: cập nhật <b>Chủ nhật</b>, đổi đến trước học <b>2h</b>",
            )
        else:
            self.bot.send_message(chat_id, "Không rõ lệnh. Gõ /help")

    # ─────────────────────────── scheduler ───────────────────────────

    def check_notifications(self) -> None:
        """Gọi mỗi vòng lặp; chỉ gửi 1 lần / loại / ngày. Sync Sheet trước khi gửi."""
        if not self.subscribers:
            return

        now = now_vn()
        minute_tag = now.strftime("%Y-%m-%d %H:%M")
        if self.last_tick_minute == minute_tag:
            return

        morning_at = datetime(
            now.year, now.month, now.day, MORNING_HOUR, MORNING_MINUTE, tzinfo=TZ
        )
        in_morning_window = morning_at <= now < morning_at + timedelta(minutes=2)

        # Ước lượng có thể sắp preclass: sync nếu gần cửa sổ gửi
        maybe_notify = in_morning_window
        if not maybe_notify:
            for day in self.schedule.get("days") or []:
                start = class_start_dt(day)
                if not start:
                    continue
                pre_at = start - timedelta(hours=PRECLASS_HOURS)
                if pre_at <= now < pre_at + timedelta(minutes=3):
                    maybe_notify = True
                    break

        if maybe_notify and SYNC_BEFORE_NOTIFY:
            self.ensure_synced(force=True)

        course = self.schedule.get("course") or "SIC2026"
        todays = today_classes(self.schedule, now.date())

        # Chủ nhật 08:00 – lịch tuần tới (sau khi sheet cập nhật)
        if in_morning_window and now.weekday() == 6:
            wk = now.date().isoformat()
            if not already_sent(wk, "weekly"):
                text = msg_weekly_update(published_week_classes(self.schedule), course)
                n = self.bot.broadcast(text, self.subscribers)
                mark_sent(wk, "weekly")
                log.info("Đã gửi weekly %s → %s chat", wk, n)

        for day in todays:
            dk = day_key(day)
            start = class_start_dt(day)
            if not start:
                continue

            if in_morning_window:
                if not already_sent(dk, "morning"):
                    text = msg_morning(day, course)
                    n = self.bot.broadcast(text, self.subscribers)
                    mark_sent(dk, "morning")
                    log.info("Đã gửi morning %s → %s chat", dk, n)

            pre_at = start - timedelta(hours=PRECLASS_HOURS)
            if pre_at <= now < pre_at + timedelta(minutes=2):
                if not already_sent(dk, "preclass"):
                    # Sync lần nữa ngay trước bản chốt
                    if SYNC_BEFORE_NOTIFY:
                        self.ensure_synced(force=True)
                        todays2 = today_classes(self.schedule, now.date())
                        day = next((x for x in todays2 if day_key(x) == dk), None)
                        if not day:
                            text = msg_preclass_cancelled(course, now.strftime("%d/%m/%Y"))
                            n = self.bot.broadcast(text, self.subscribers)
                            mark_sent(dk, "preclass")
                            log.info("Preclass cancelled %s → %s chat", dk, n)
                            continue
                    text = msg_preclass(day, course)
                    n = self.bot.broadcast(text, self.subscribers)
                    mark_sent(dk, "preclass")
                    log.info("Đã gửi preclass %s → %s chat", dk, n)

        self.last_tick_minute = minute_tag

    def run(self) -> None:
        me = self.bot.get_me()
        log.info("Bot @%s đã sẵn sàng", me.get("username"))
        log.info("Múi giờ: Asia/Ho_Chi_Minh | Sáng %02d:%02d | Trước học %sh", MORNING_HOUR, MORNING_MINUTE, PRECLASS_HOURS)
        log.info("Subscribers: %s", ", ".join(self.subscribers) or "(chưa có – hãy /start bot)")
        log.info("Buổi xếp lịch: %s", len(self.schedule.get("days") or []))

        # long-poll commands + tick notifications
        while True:
            try:
                self.ensure_synced(force=False)
                self.check_notifications()

                # poll updates (short) so commands remain responsive
                updates = self.bot.get_updates(timeout=15)
                for upd in updates:
                    try:
                        self.handle_update(upd)
                    except Exception:
                        log.error("Lỗi xử lý update:\n%s", traceback.format_exc())

                # sau getUpdates, check lại (có thể đã qua mốc giờ)
                self.check_notifications()
            except KeyboardInterrupt:
                log.info("Dừng bot.")
                break
            except Exception:
                log.error("Lỗi vòng lặp:\n%s", traceback.format_exc())
                time.sleep(5)


def main() -> None:
    # reload subscribers from env each start
    app = App()
    # merge env chat ids
    for c in bootstrap_chat_ids():
        app.subscribers.add(c)
    save_subscribers(app.subscribers)
    app.run()


if __name__ == "__main__":
    main()
