/**
 * Tải & parse lịch học từ Google Sheets (CSV export).
 */
const SHEET_ID = "1nnYhUeWdgkSE8wZvagctTT28VT7nyTUd9e3gDi8m-4s";
const GID = "1271431527";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;

/** Parse CSV (hỗ trợ quoted multiline). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseDateVN(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDate(d) {
  if (!d) return null;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function weekdayVN(d) {
  // UTC date parts used as calendar date
  const wd = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
  // getUTCDay: 0=Sun
  return wd[d.getUTCDay()];
}

function parseStartHm(timeStr) {
  const m = String(timeStr || "").match(/(\d{1,2})[h:](\d{2})/i);
  if (!m) return { h: 18, m: 0 };
  return { h: +m[1], m: +m[2] };
}

/**
 * @returns {Promise<object>} schedule payload
 */
async function fetchSchedule() {
  const res = await fetch(`${CSV_URL}&_=${Date.now()}`, {
    headers: { "User-Agent": "lich-hoc-sic2026/1.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`);
  const text = await res.text();
  if (!text || text.includes("<!DOCTYPE")) throw new Error("Không đọc được Google Sheet");
  return buildFromCsv(text);
}

function buildFromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("CSV rỗng");

  const dataRows = rows.slice(1).map((r) => {
    while (r.length < 10) r.push("");
    return {
      so_tiet: (r[0] || "").trim(),
      chu_de_ngay: (r[1] || "").trim(),
      chu_de_tiet: (r[2] || "").trim(),
      noi_dung: (r[3] || "").trim(),
      tai_lieu: (r[4] || "").trim(),
      type: (r[5] || "").trim(),
      date: (r[6] || "").trim(),
      lecturer: (r[7] || "").trim(),
      time: (r[8] || "").trim(),
      classroom: (r[9] || "").trim(),
    };
  });

  let curDate = "";
  let curTopic = "";
  let curLec = "";
  let curTime = "";
  let curRoom = "";
  let curType = "";
  let curMat = "";
  const lessons = [];

  for (const r of dataRows) {
    if (r.chu_de_ngay && r.chu_de_ngay !== curTopic) {
      curDate = r.date || "";
      curTopic = r.chu_de_ngay;
    } else if (r.date) {
      curDate = r.date;
    }
    if (r.lecturer) curLec = r.lecturer;
    if (r.time) curTime = r.time;
    if (r.classroom) curRoom = r.classroom;
    if (r.type) curType = r.type;
    if (r.tai_lieu) curMat = r.tai_lieu;
    if (!r.chu_de_tiet && !r.noi_dung && !r.so_tiet) continue;
    if (r.so_tiet && !r.chu_de_tiet && !r.noi_dung) continue;

    lessons.push({
      so_tiet: r.so_tiet,
      day_topic: curTopic,
      lesson_topic: r.chu_de_tiet,
      content: r.noi_dung,
      material: curMat,
      type: curType,
      date: curDate,
      lecturer: curDate ? curLec : "",
      time: curDate ? curTime : "",
      classroom: curDate ? curRoom : "",
      scheduled: !!curDate,
    });
  }

  const dayMap = new Map();
  for (const les of lessons) {
    if (!les.scheduled) continue;
    if (!dayMap.has(les.date)) {
      dayMap.set(les.date, {
        date: les.date,
        date_iso: null,
        weekday: null,
        day_topic: les.day_topic,
        topics: [],
        lecturer: les.lecturer,
        time: les.time || "18h00-21h00",
        classroom: les.classroom,
        type: les.type || "Offline class",
        material: les.material,
        lessons: [],
      });
    }
    const day = dayMap.get(les.date);
    for (const f of ["lecturer", "time", "classroom", "type", "material"]) {
      if (les[f]) day[f] = les[f];
    }
    if (les.day_topic && !day.topics.includes(les.day_topic)) {
      day.topics.push(les.day_topic);
      day.day_topic =
        day.topics.length > 1 ? day.topics.join(" · ") : day.topics[0];
    }
    if (les.lesson_topic || les.content) {
      day.lessons.push({
        so_tiet: les.so_tiet,
        title: les.lesson_topic,
        content: les.content,
        module: les.day_topic,
      });
    }
  }

  const days = [...dayMap.values()]
    .map((day) => {
      const dt = parseDateVN(day.date);
      if (dt) {
        day.date_iso = toIsoDate(dt);
        day.weekday = weekdayVN(dt);
        day.sort_key = day.date_iso;
      } else {
        day.sort_key = day.date;
      }
      return day;
    })
    .sort((a, b) => a.sort_key.localeCompare(b.sort_key));

  return {
    course: "SIC2026 ICTU – Bản dẫn cơ bản No1",
    source: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${GID}`,
    sheet_id: SHEET_ID,
    gid: GID,
    updated_at: new Date().toISOString(),
    days,
    stats: {
      total_days: days.length,
      total_lessons: days.reduce((s, d) => s + d.lessons.length, 0),
    },
  };
}

/** Ngày hôm nay theo lịch Việt Nam (YYYY-MM-DD). */
function todayIsoVN(now = new Date()) {
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function nowPartsVN(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  return {
    year: +parts.year,
    month: +parts.month,
    day: +parts.day,
    hour: +parts.hour,
    minute: +parts.minute,
    second: +parts.second,
    iso: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function todayClasses(data, iso = todayIsoVN()) {
  return (data.days || []).filter((d) => d.date_iso === iso || d.sort_key === iso);
}

function parseEndHm(timeStr) {
  const m = String(timeStr || "").match(/-(\d{1,2})[h:](\d{2})/i);
  if (!m) {
    const s = parseStartHm(timeStr);
    return { h: Math.min(s.h + 3, 23), m: s.m }; // mặc định +3h
  }
  return { h: +m[1], m: +m[2] };
}

/** start/end theo phút tuyệt đối (mốc ngày VN). */
function classBounds(day) {
  if (!day?.date_iso) return null;
  const start = parseStartHm(day.time);
  const end = parseEndHm(day.time);
  const day0 = Date.parse(`${day.date_iso}T00:00:00+07:00`) / 60000;
  return {
    startMin: day0 + start.h * 60 + start.m,
    endMin: day0 + end.h * 60 + end.m,
    start,
    end,
  };
}

function nowMinVN(now = new Date()) {
  const vn = nowPartsVN(now);
  return Date.parse(`${vn.iso}T00:00:00+07:00`) / 60000 + vn.hour * 60 + vn.minute;
}

/**
 * Phân loại buổi học theo thời điểm hiện tại (giờ VN).
 * - current: đang trong khung giờ học (start ≤ now < end)
 * - endingSoon: còn ≤ 30 phút là hết giờ
 * - next: buổi tiếp theo (start > now)
 */
function classFocus(data, now = new Date()) {
  const nowMin = nowMinVN(now);
  const ENDING_SOON_MIN = 30;

  let current = null;
  let next = null;
  const scored = [];

  for (const day of data.days || []) {
    const b = classBounds(day);
    if (!b) continue;
    scored.push({ day, ...b });
  }
  scored.sort((a, b) => a.startMin - b.startMin);

  for (const item of scored) {
    if (item.startMin <= nowMin && nowMin < item.endMin) {
      current = item.day;
      const minsLeft = item.endMin - nowMin;
      const endingSoon = minsLeft <= ENDING_SOON_MIN;
      // next = buổi sau current
      const idx = scored.indexOf(item);
      next = scored[idx + 1]?.day || null;
      return {
        current,
        next,
        endingSoon,
        minsLeft,
        status: endingSoon ? "ending_soon" : "ongoing",
        focus: current,
      };
    }
  }

  for (const item of scored) {
    if (item.startMin > nowMin) {
      next = item.day;
      const minsUntil = item.startMin - nowMin;
      return {
        current: null,
        next,
        endingSoon: false,
        minsLeft: null,
        minsUntil,
        status: "upcoming",
        focus: next,
      };
    }
  }

  return {
    current: null,
    next: null,
    endingSoon: false,
    minsLeft: null,
    status: "none",
    focus: null,
  };
}

/**
 * Buổi đang diễn ra (trong khung giờ), hoặc buổi sắp tới nếu không đang học.
 * Dùng cho banner "trạng thái hiện tại", không dùng cho nút "Buổi tới".
 */
function nextClass(data, now = new Date()) {
  const f = classFocus(data, now);
  return f.focus;
}

/**
 * Buổi TIẾP THEO chưa bắt đầu (start > now).
 * - Đang học 21/07 → trả 22/07
 * - Chưa tới giờ 22/07 → trả 22/07
 * - Hết lịch → null
 */
function upcomingClass(data, now = new Date()) {
  const f = classFocus(data, now);
  // classFocus đã set `next` = buổi start > now (kể cả khi đang học)
  // và khi status=upcoming thì `next` chính là buổi sắp tới
  return f.next || null;
}

function addDaysIso(iso, days) {
  const [y, mo, d] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return toIsoDate(utc);
}

/** Thứ trong tuần VN: 0=CN, 1=T2 ... 6=T7 */
function weekdayIndexVN(iso = todayIsoVN()) {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function isSundayVN(iso = todayIsoVN()) {
  return weekdayIndexVN(iso) === 0;
}

/** Tuần hiện tại (Thứ 2 → CN) theo lịch VN. */
function currentWeekRange(iso = todayIsoVN()) {
  const [y, mo, d] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  const dow = (utc.getUTCDay() + 6) % 7; // 0=Mon
  const monday = new Date(utc);
  monday.setUTCDate(utc.getUTCDate() - dow);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { monIso: toIsoDate(monday), sunIso: toIsoDate(sunday) };
}

/**
 * Tuần tới sau khi sheet cập nhật Chủ nhật:
 * CN → Mon..Sun tuần sau; các ngày khác → tuần hiện tại.
 */
function targetWeekRange(iso = todayIsoVN()) {
  if (isSundayVN(iso)) {
    const monIso = addDaysIso(iso, 1);
    const sunIso = addDaysIso(monIso, 6);
    return { monIso, sunIso, label: "tuần tới" };
  }
  const r = currentWeekRange(iso);
  return { ...r, label: "tuần này" };
}

function weekClasses(data, now = new Date()) {
  const iso = todayIsoVN(now);
  const { monIso, sunIso } = currentWeekRange(iso);
  return (data.days || []).filter(
    (day) => day.date_iso && day.date_iso >= monIso && day.date_iso <= sunIso
  );
}

/** Lịch tuần được công bố (CN = tuần tới). */
function publishedWeekClasses(data, now = new Date()) {
  const iso = todayIsoVN(now);
  const { monIso, sunIso } = targetWeekRange(iso);
  return (data.days || []).filter(
    (day) => day.date_iso && day.date_iso >= monIso && day.date_iso <= sunIso
  );
}

/** Fingerprint ngắn để phát hiện đổi lịch (phòng/giờ/chủ đề). */
function scheduleFingerprint(days) {
  return (days || [])
    .map(
      (d) =>
        `${d.date_iso || d.date}|${d.time}|${d.classroom}|${d.lecturer}|${d.day_topic}`
    )
    .join("||");
}

module.exports = {
  SHEET_ID,
  GID,
  fetchSchedule,
  buildFromCsv,
  todayIsoVN,
  nowPartsVN,
  todayClasses,
  nextClass,
  upcomingClass,
  classFocus,
  classBounds,
  parseEndHm,
  nowMinVN,
  weekClasses,
  publishedWeekClasses,
  currentWeekRange,
  targetWeekRange,
  isSundayVN,
  weekdayIndexVN,
  addDaysIso,
  scheduleFingerprint,
  parseStartHm,
  parseDateVN,
};
