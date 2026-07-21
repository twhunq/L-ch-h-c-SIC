/**
 * Vercel Cron – thông báo lịch học (luôn fetch Sheet mới nhất).
 *
 * Quy tắc:
 *  - Sheet cập nhật mỗi Chủ nhật; có thể đổi đến trước giờ học 2 tiếng
 *  - 08:00 VN mỗi ngày: nếu có học → morning; nếu Chủ nhật → weekly digest
 *  - 16:00 VN (trước 18:00 2h): preclass bản chốt; nếu không còn lịch → báo hủy/dời
 *
 * UTC: 0 1 * * * = 08:00 VN | 0 9 * * * = 16:00 VN
 */
const {
  fetchSchedule,
  todayClasses,
  nowPartsVN,
  parseStartHm,
  publishedWeekClasses,
  targetWeekRange,
  isSundayVN,
} = require("../lib/schedule");
const {
  msgMorning,
  msgPreclass,
  msgWeeklyUpdate,
  msgPreclassCancelled,
} = require("../lib/messages");
const { broadcast, getChatIds } = require("../lib/telegram");

const PRECLASS_HOURS = 2;

function checkAuth(req) {
  const secret = (process.env.CRON_SECRET || "").trim();
  const auth = req.headers.authorization || "";
  const q = req.query || {};

  if (req.headers["x-vercel-cron"] === "1") return true;
  if (secret && auth === `Bearer ${secret}`) return true;
  if (secret && (q.secret === secret || q.key === secret)) return true;
  if (!secret && !process.env.VERCEL) return true;
  return false;
}

function resolveType(req, vn) {
  let type = (req.query?.type || "").toLowerCase();
  if (type) return type;
  if (vn.hour === 8) return "morning";
  if (vn.hour === 16) return "preclass";
  return "auto";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!checkAuth(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const chats = getChatIds();
  if (!chats.length) {
    return res.status(400).json({
      ok: false,
      error:
        "TELEGRAM_CHAT_IDS trống. Thêm chat id vào Environment Variables trên Vercel.",
    });
  }

  try {
    // Luôn lấy lịch mới nhất từ Sheet (phản ánh cập nhật CN + đổi trước 2h)
    const data = await fetchSchedule();
    const vn = nowPartsVN();
    const force = req.query?.force === "1" || req.query?.force === "true";
    const type = resolveType(req, vn);
    const course = data.course || "SIC2026";
    const todays = todayClasses(data, vn.iso);
    const sent = [];

    // ─── Test ───
    if (type === "test") {
      const day = todays[0] || data.days?.[0];
      const range = targetWeekRange(vn.iso);
      const weekDays = publishedWeekClasses(data);
      const rWeekly = await broadcast(
        msgWeeklyUpdate(weekDays, course, range),
        chats
      );
      const out = { ok: true, type: "test", weekly: rWeekly, vn, range };
      if (day) {
        out.morning = await broadcast(msgMorning(day, course), chats);
        out.preclass = await broadcast(
          msgPreclass(day, course, PRECLASS_HOURS),
          chats
        );
        out.date = day.date;
      }
      return res.status(200).json(out);
    }

    // ─── Weekly (Chủ nhật hoặc ?type=weekly) ───
    if (type === "weekly" || (type === "morning" && isSundayVN(vn.iso))) {
      const range = targetWeekRange(vn.iso);
      const weekDays = publishedWeekClasses(data);
      const results = await broadcast(
        msgWeeklyUpdate(weekDays, course, range),
        chats
      );
      sent.push({
        kind: "weekly",
        range,
        count: weekDays.length,
        results,
      });
      // Chủ nhật: chỉ gửi weekly (+ morning nếu cũng có học hôm nay — hiếm)
      if (type === "weekly") {
        return res.status(200).json({
          ok: true,
          type: "weekly",
          date: vn.iso,
          vn,
          sent,
          chats: chats.length,
          synced_at: data.updated_at,
        });
      }
    }

    // ─── Morning (ngày có học) ───
    if (type === "morning" || type === "auto") {
      if (type === "morning" || vn.hour === 8 || force) {
        for (const day of todays) {
          const results = await broadcast(msgMorning(day, course), chats);
          sent.push({
            kind: "morning",
            date: day.date,
            topic: day.day_topic,
            results,
          });
        }
        if (type === "morning") {
          return res.status(200).json({
            ok: true,
            type: "morning",
            date: vn.iso,
            vn,
            classes: todays.map((d) => ({
              date: d.date,
              time: d.time,
              topic: d.day_topic,
            })),
            sent,
            chats: chats.length,
            synced_at: data.updated_at,
            note: todays.length
              ? "Đã gửi morning"
              : isSundayVN(vn.iso)
                ? "Chủ nhật: đã gửi weekly; hôm nay không có buổi học"
                : "Hôm nay không có lịch học",
          });
        }
      }
    }

    // ─── Preclass (bản chốt trước 2h) ───
    if (type === "preclass" || type === "auto") {
      if (!todays.length) {
        // Có thể lớp đã hủy/dời trên Sheet trước mốc 2h
        if (type === "preclass") {
          const results = await broadcast(
            msgPreclassCancelled(course, vn.iso),
            chats
          );
          sent.push({ kind: "preclass_cancelled", date: vn.iso, results });
        }
        return res.status(200).json({
          ok: true,
          type,
          date: vn.iso,
          vn,
          message: "Không còn lịch hôm nay trên Sheet",
          sent,
          chats: chats.length,
          synced_at: data.updated_at,
        });
      }

      for (const day of todays) {
        const { h, m } = parseStartHm(day.time);
        const preH = (h - PRECLASS_HOURS + 24) % 24;
        const nowMin = vn.hour * 60 + vn.minute;
        const preMin = preH * 60 + m;
        const inWindow = Math.abs(nowMin - preMin) <= 15;
        const classic1800 = h === 18 && vn.hour === 16;

        if (type === "preclass" || force || inWindow || classic1800) {
          if (
            type === "preclass" ||
            force ||
            inWindow ||
            classic1800
          ) {
            // type=preclass từ cron 16:00: gửi nếu khớp cửa sổ hoặc lớp 18h
            const allow =
              force ||
              inWindow ||
              classic1800 ||
              (type === "preclass" && (h === 18 || inWindow));
            if (!allow && type !== "preclass") {
              sent.push({
                kind: "preclass_skip",
                date: day.date,
                reason: `Mốc nhắc ${preH}:${String(m).padStart(2, "0")}`,
              });
              continue;
            }
            // Cron preclass: ưu tiên gửi khi class 18:00 hoặc trong cửa sổ
            if (
              type === "preclass" &&
              !force &&
              !inWindow &&
              !classic1800 &&
              h !== 18
            ) {
              sent.push({
                kind: "preclass_skip",
                date: day.date,
                reason: `Giờ học ${day.time} không khớp cron 16:00`,
              });
              continue;
            }

            const results = await broadcast(
              msgPreclass(day, course, PRECLASS_HOURS),
              chats
            );
            sent.push({
              kind: "preclass",
              date: day.date,
              topic: day.day_topic,
              time: day.time,
              classroom: day.classroom,
              results,
            });
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      type,
      date: vn.iso,
      vn,
      classes: todays.map((d) => ({
        date: d.date,
        time: d.time,
        classroom: d.classroom,
        topic: d.day_topic,
      })),
      sent,
      chats: chats.length,
      synced_at: data.updated_at,
      policy: {
        weekly_update: "Chủ nhật",
        last_change_before_class_hours: PRECLASS_HOURS,
        always_live_sheet: true,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
