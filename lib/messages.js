function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const POLICY_NOTE =
  "📌 <i>Lịch cập nhật mỗi <b>Chủ nhật</b>; có thể đổi đến trước giờ học <b>2 tiếng</b>. Bot luôn lấy bản mới nhất từ Sheet.</i>";

function fmtDayShort(day) {
  const lessons = day.lessons || [];
  const titles = [];
  for (const les of lessons.slice(0, 5)) {
    const t = (les.title || "").trim();
    if (t) titles.push(`  • ${esc(t)}`);
  }
  let more = "";
  if (lessons.length > 5) more = `\n  • … và ${lessons.length - 5} tiết nữa`;
  const body = titles.length
    ? titles.join("\n") + more
    : "  • (xem sheet để biết chi tiết)";

  return (
    `📘 <b>${esc(day.day_topic)}</b>\n` +
    `📅 ${esc(day.weekday)} · ${esc(day.date)}\n` +
    `⏰ ${esc(day.time || "18h00-21h00")}\n` +
    `📍 Phòng <b>${esc(day.classroom || "—")}</b>\n` +
    `👤 ${esc(day.lecturer || "—")}\n` +
    `🏷 ${esc(day.type || "Offline class")}\n` +
    `📎 ${esc(day.material || "Slide bài giảng")}\n\n` +
    `<b>Nội dung (${lessons.length} tiết):</b>\n${body}`
  );
}

function fmtDayLine(day) {
  return (
    `• <b>${esc(day.date)}</b> (${esc(day.weekday)}) ` +
    `${esc(day.time || "18h00-21h00")} · 📍 ${esc(day.classroom || "—")}\n` +
    `  ${esc(day.day_topic)}\n` +
    `  👤 ${esc(day.lecturer || "—")}`
  );
}

function msgMorning(day, course) {
  return (
    `☀️ <b>Chào buổi sáng – Hôm nay có lịch học!</b>\n` +
    `<i>${esc(course)}</i>\n\n` +
    `${fmtDayShort(day)}\n\n` +
    `💡 Nhắc lại trước giờ học <b>2 tiếng</b> (lịch chốt lần cuối).\n` +
    `${POLICY_NOTE}\n` +
    `Gõ /today hoặc /next để xem lại.`
  );
}

function msgPreclass(day, course, preHours = 2) {
  const { h, m } = require("./schedule").parseStartHm(day.time);
  const hhmm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return (
    `⏰ <b>Sắp đến giờ học (còn ~${preHours} giờ)</b>\n` +
    `<i>${esc(course)}</i>\n\n` +
    `🔄 <b>Lịch mới nhất từ Sheet</b> (đã qua thời điểm có thể đổi lịch)\n` +
    `Bắt đầu lúc <b>${esc(hhmm)}</b>\n\n` +
    `${fmtDayShort(day)}\n\n` +
    `🎒 Kiểm tra lại <b>phòng · giờ · giảng viên</b> rồi di chuyển tới lớp nhé!`
  );
}

/**
 * Thông báo Chủ nhật: lịch tuần tới sau khi sheet được cập nhật.
 * @param {object[]} days
 * @param {string} course
 * @param {{ monIso: string, sunIso: string, label?: string }} range
 */
function msgWeeklyUpdate(days, course, range) {
  const mon = range.monIso || "";
  const sun = range.sunIso || "";
  const monDisp = mon ? mon.split("-").reverse().join("/") : "—";
  const sunDisp = sun ? sun.split("-").reverse().join("/") : "—";
  const label = range.label || "tuần tới";

  if (!days.length) {
    return (
      `🗓 <b>Cập nhật lịch học ${label}</b>\n` +
      `<i>${esc(course)}</i>\n\n` +
      `📅 ${esc(monDisp)} → ${esc(sunDisp)}\n\n` +
      `📭 Chưa có buổi nào được xếp trên Sheet.\n` +
      `Bot sẽ báo lại khi có lịch (và trước giờ học 2 tiếng).\n\n` +
      POLICY_NOTE
    );
  }

  const lines = days.map(fmtDayLine).join("\n\n");
  return (
    `🗓 <b>Lịch học ${label} đã cập nhật</b>\n` +
    `<i>${esc(course)}</i>\n\n` +
    `📅 ${esc(monDisp)} → ${esc(sunDisp)} · <b>${days.length}</b> buổi\n\n` +
    `${lines}\n\n` +
    `☀️ Nhắc 08:00 sáng ngày có học\n` +
    `⏰ Nhắc trước giờ học 2 tiếng (bản chốt)\n\n` +
    POLICY_NOTE
  );
}

/** Khi tới mốc preclass mà sheet không còn buổi hôm nay (có thể hủy/dời). */
function msgPreclassCancelled(course, dateLabel) {
  return (
    `⚠️ <b>Không còn lịch học hôm nay trên Sheet</b>\n` +
    `<i>${esc(course)}</i>\n\n` +
    `Ngày ${esc(dateLabel)} hiện <b>không có</b> buổi đã xếp.\n` +
    `Có thể lớp đã <b>hủy / dời lịch</b> trước mốc 2 tiếng.\n\n` +
    `Gõ /next để xem buổi sắp tới · /week xem cả tuần.\n` +
    POLICY_NOTE
  );
}

function msgHelp() {
  return (
    `🤖 <b>Bot lịch học SIC2026</b>\n\n` +
    `<b>Quy tắc lịch:</b>\n` +
    `• Sheet cập nhật mỗi <b>Chủ nhật</b>\n` +
    `• Có thể đổi đến trước giờ học <b>2 tiếng</b>\n` +
    `• Mỗi lần báo → bot đọc Sheet mới nhất\n\n` +
    `<b>Tự động (giờ VN):</b>\n` +
    `• <b>Chủ nhật 08:00</b> – lịch tuần tới\n` +
    `• <b>08:00</b> – ngày có học\n` +
    `• <b>Trước 2 giờ</b> – nhắc vào lớp (bản chốt)\n\n` +
    `<b>Lệnh:</b>\n` +
    `/start – chào & Chat ID\n` +
    `/today – lịch hôm nay\n` +
    `/next – buổi sắp tới\n` +
    `/week – lịch tuần\n` +
    `/test – gửi thử\n` +
    `/status – trạng thái\n` +
    `/help – trợ giúp`
  );
}

function msgTodayNone() {
  return (
    "📭 Hôm nay <b>không có</b> buổi học trong lịch đã xếp.\n" +
    "Gõ /next để xem buổi sắp tới.\n" +
    POLICY_NOTE
  );
}

module.exports = {
  esc,
  POLICY_NOTE,
  fmtDayShort,
  fmtDayLine,
  msgMorning,
  msgPreclass,
  msgWeeklyUpdate,
  msgPreclassCancelled,
  msgHelp,
  msgTodayNone,
};
