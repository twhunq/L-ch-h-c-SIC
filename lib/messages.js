const { divider, header, WEB_HREF } = require("./ui");

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const POLICY_NOTE =
  `📌 <i>Lịch cập nhật <b>Chủ nhật</b> · có thể đổi đến trước học <b>2 tiếng</b></i>`;

function fmtLessons(day, max = 6) {
  const lessons = day.lessons || [];
  if (!lessons.length) return "  <i>Chưa có tiết chi tiết</i>";
  const lines = [];
  lessons.slice(0, max).forEach((les, i) => {
    const n = les.so_tiet || String(i + 1);
    const t = (les.title || "Nội dung").trim();
    lines.push(`  <b>${esc(n)}.</b> ${esc(t)}`);
  });
  if (lessons.length > max) {
    lines.push(`  <i>… +${lessons.length - max} tiết nữa</i>`);
  }
  return lines.join("\n");
}

/** Thẻ buổi học – giao diện đẹp, dễ đọc trên mobile */
function fmtDayCard(day, { compact = false } = {}) {
  const lessons = day.lessons || [];
  let out =
    `📘 <b>${esc(day.day_topic)}</b>\n` +
    `${divider()}\n` +
    `📅 <b>${esc(day.weekday)}</b> · ${esc(day.date)}\n` +
    `⏰ ${esc(day.time || "18h00-21h00")}\n` +
    `📍 Phòng <b>${esc(day.classroom || "—")}</b>\n` +
    `👤 ${esc(day.lecturer || "—")}\n` +
    `🏷 ${esc(day.type || "Offline")} · 📎 ${esc(day.material || "Slide")}`;

  if (!compact) {
    out +=
      `\n${divider()}\n` +
      `📝 <b>Nội dung (${lessons.length} tiết)</b>\n` +
      fmtLessons(day);
  } else {
    out += `\n📝 ${lessons.length} tiết · bấm chi tiết bên dưới`;
  }
  return out;
}

function fmtDayLine(day) {
  return (
    `▫️ <b>${esc(day.date)}</b> · ${esc(day.weekday)}\n` +
    `   ⏰ ${esc(day.time || "18h00-21h00")} · 📍 <b>${esc(day.classroom || "—")}</b>\n` +
    `   ${esc(truncate(day.day_topic, 72))}`
  );
}

function truncate(s, n) {
  const t = String(s || "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function msgWelcome(name, { registered, redisOk, nextDay, course }) {
  let status;
  if (registered) {
    status = "✅ <b>Đang bật thông báo</b> — bạn sẽ nhận tin cùng lớp";
  } else if (!redisOk) {
    status = "⚠️ Hệ thống lưu user chưa sẵn sàng (admin cần bật Redis)";
  } else {
    status = "🔔 Chưa bật thông báo — bấm <b>Bật thông báo</b> bên dưới";
  }

  let nextBlock = "";
  if (nextDay) {
    nextBlock =
      `\n\n${header("📌", "Buổi sắp tới")}\n` +
      fmtDayCard(nextDay, { compact: true });
  }

  return (
    `${header("🎓", "SIC2026 · Lịch học ICTU")}\n` +
    `Xin chào <b>${esc(name)}</b> 👋\n` +
    `<i>${esc(course || "Samsung Innovation Campus")}</i>\n\n` +
    `${status}\n\n` +
    `👇 <b>Dùng nút bên dưới</b> — không cần gõ lệnh\n` +
    `• 📅 Hôm nay · 📌 Buổi tới · 🗓 Tuần\n` +
    `• 🌐 Xem web đầy đủ: ${WEB_HREF}\n` +
    nextBlock +
    `\n\n${POLICY_NOTE}`
  );
}

function msgMenu({ registered, nextSummary }) {
  return (
    `${header("🏠", "Menu chính")}\n` +
    `Thông báo: <b>${registered ? "ĐANG BẬT ✅" : "ĐANG TẮT 🔕"}</b>\n` +
    (nextSummary ? `\n📌 Sắp tới: <b>${esc(nextSummary)}</b>\n` : "\n") +
    `\nChọn nhanh:\n` +
    `📅 Hôm nay — lịch trong ngày\n` +
    `📌 Buổi tới — buổi gần nhất\n` +
    `🗓 Tuần này — toàn bộ tuần\n` +
    `🌐 Xem web — giao diện đầy đủ\n\n` +
    `${POLICY_NOTE}`
  );
}

function msgMorning(day, course) {
  return (
    `${header("☀️", "Hôm nay có lịch học!")}\n` +
    `<i>${esc(course)}</i>\n\n` +
    fmtDayCard(day) +
    `\n\n💡 Nhắc lại trước giờ học <b>2 tiếng</b> (bản chốt).\n` +
    POLICY_NOTE
  );
}

function msgPreclass(day, course, preHours = 2) {
  const { h, m } = require("./schedule").parseStartHm(day.time);
  const hhmm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return (
    `${header("⏰", `Sắp học · còn ~${preHours} giờ`)}\n` +
    `<i>${esc(course)}</i>\n\n` +
    `🔄 <b>Lịch chốt từ Sheet</b> · bắt đầu <b>${esc(hhmm)}</b>\n\n` +
    fmtDayCard(day) +
    `\n\n🎒 Kiểm tra <b>phòng · giờ · GV</b> rồi tới lớp nhé!`
  );
}

function msgWeeklyUpdate(days, course, range) {
  const mon = range.monIso || "";
  const sun = range.sunIso || "";
  const monDisp = mon ? mon.split("-").reverse().join("/") : "—";
  const sunDisp = sun ? sun.split("-").reverse().join("/") : "—";
  const label = range.label || "tuần tới";

  if (!days.length) {
    return (
      `${header("🗓", `Lịch ${label}`)}\n` +
      `<i>${esc(course)}</i>\n` +
      `📅 ${esc(monDisp)} → ${esc(sunDisp)}\n\n` +
      `📭 Chưa có buổi xếp trên Sheet.\n\n` +
      POLICY_NOTE
    );
  }

  return (
    `${header("🗓", `Lịch ${label}`)}\n` +
    `<i>${esc(course)}</i>\n` +
    `📅 ${esc(monDisp)} → ${esc(sunDisp)} · <b>${days.length}</b> buổi\n` +
    `${divider()}\n` +
    days.map(fmtDayLine).join("\n\n") +
    `\n\n☀️ 08:00 ngày có học · ⏰ trước giờ 2 tiếng\n` +
    POLICY_NOTE
  );
}

function msgPreclassCancelled(course, dateLabel) {
  return (
    `${header("⚠️", "Không còn lịch hôm nay")}\n` +
    `<i>${esc(course)}</i>\n\n` +
    `Ngày <b>${esc(dateLabel)}</b> không còn buổi trên Sheet.\n` +
    `Có thể đã <b>hủy / dời</b> trước mốc 2 tiếng.\n\n` +
    `Bấm <b>📌 Buổi tới</b> để kiểm tra.\n` +
    POLICY_NOTE
  );
}

function msgHelp() {
  return (
    `${header("ℹ️", "Hướng dẫn nhanh")}\n` +
    `<b>Cách dùng</b>\n` +
    `1. Bấm <b>✅ Bật thông báo</b> (hoặc /start)\n` +
    `2. Dùng <b>nút dưới màn hình</b> để xem lịch\n` +
    `3. Mở web khi cần xem chi tiết đầy đủ\n\n` +
    `<b>Bot tự gửi (giờ VN)</b>\n` +
    `• CN 08:00 — lịch tuần mới\n` +
    `• 08:00 — ngày có học\n` +
    `• Trước học 2h — nhắc chốt phòng/giờ\n\n` +
    `<b>Lệnh (tuỳ chọn)</b>\n` +
    `/today /next /week /web /status /stop\n\n` +
    `🌐 ${WEB_HREF}\n` +
    POLICY_NOTE
  );
}

function msgTodayNone() {
  return (
    `${header("📭", "Hôm nay trống lịch")}\n` +
    `Không có buổi học đã xếp hôm nay.\n` +
    `Bấm <b>📌 Buổi tới</b> hoặc <b>🗓 Tuần này</b>.\n\n` +
    POLICY_NOTE
  );
}

function msgToday(days) {
  if (!days.length) return msgTodayNone();
  if (days.length === 1) {
    return `${header("📅", "Lịch hôm nay")}\n` + fmtDayCard(days[0]);
  }
  return (
    `${header("📅", `Hôm nay · ${days.length} buổi`)}\n` +
    days.map((d, i) => `<b>Buổi ${i + 1}</b>\n` + fmtDayCard(d)).join("\n\n")
  );
}

function msgNext(day) {
  if (!day) {
    return (
      `${header("📌", "Buổi sắp tới")}\n` +
      `Không còn buổi nào trong lịch đã xếp.\n` +
      `Chờ cập nhật Chủ nhật hoặc xem web.`
    );
  }
  return `${header("📌", "Buổi học sắp tới")}\n` + fmtDayCard(day);
}

function msgStopped() {
  return (
    `${header("🔕", "Đã tắt thông báo")}\n` +
    `Bạn sẽ <b>không</b> nhận tin tự động nữa.\n` +
    `Vẫn xem lịch bằng nút bên dưới.\n\n` +
    `Bật lại: <b>✅ Bật thông báo</b> hoặc /start`
  );
}

function msgStatus({ registered, stats, nextDay, vn, chatId }) {
  const nxt = nextDay
    ? `${esc(nextDay.date)} ${esc(nextDay.time || "")} · ${esc(truncate(nextDay.day_topic, 40))}`
    : "—";
  return (
    `${header("📊", "Trạng thái của bạn")}\n` +
    `🔔 Thông báo: <b>${registered ? "BẬT ✅" : "TẮT 🔕"}</b>\n` +
    `👥 Tổng người nhận bot: <b>${stats.total ?? 0}</b>\n` +
    `🕐 Giờ VN: <code>${esc(vn.iso)} ${String(vn.hour).padStart(2, "0")}:${String(vn.minute).padStart(2, "0")}</code>\n` +
    `📌 Buổi tới: ${nxt}\n` +
    `🆔 <code>${esc(chatId)}</code>\n\n` +
    POLICY_NOTE
  );
}

// alias cũ
const fmtDayShort = (day) => fmtDayCard(day);

module.exports = {
  esc,
  POLICY_NOTE,
  fmtDayCard,
  fmtDayShort,
  fmtDayLine,
  msgWelcome,
  msgMenu,
  msgMorning,
  msgPreclass,
  msgWeeklyUpdate,
  msgPreclassCancelled,
  msgHelp,
  msgTodayNone,
  msgToday,
  msgNext,
  msgStopped,
  msgStatus,
};
