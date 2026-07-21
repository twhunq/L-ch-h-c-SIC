/**
 * Telegram Webhook – xử lý lệnh /start /today /next ...
 * Đăng ký: POST /api/setup-webhook sau khi deploy
 */
const {
  fetchSchedule,
  todayClasses,
  nextClass,
  publishedWeekClasses,
  targetWeekRange,
  nowPartsVN,
} = require("../lib/schedule");
const {
  fmtDayShort,
  msgMorning,
  msgPreclass,
  msgWeeklyUpdate,
  msgHelp,
  msgTodayNone,
  esc,
} = require("../lib/messages");
const { sendMessage, getChatIds } = require("../lib/telegram");

function checkSecret(req) {
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (!secret) return true;
  const header = req.headers["x-telegram-bot-api-secret-token"];
  return header === secret;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      service: "telegram-webhook",
      hint: "POST updates from Telegram",
    });
  }

  if (!checkSecret(req)) {
    return res.status(401).json({ ok: false, error: "bad secret" });
  }

  try {
    const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const msg = update?.message;
    if (!msg?.chat?.id) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const chatId = String(msg.chat.id);
    const text = (msg.text || "").trim();
    if (!text.startsWith("/")) {
      await sendMessage(
        chatId,
        "Gõ /help để xem lệnh.\nGõ /start để xem Chat ID (cần thêm vào Vercel TELEGRAM_CHAT_IDS để nhận thông báo tự động)."
      );
      return res.status(200).json({ ok: true });
    }

    const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();
    let data;
    try {
      data = await fetchSchedule();
    } catch (e) {
      await sendMessage(chatId, `❌ Không tải được lịch: ${esc(e.message)}`);
      return res.status(200).json({ ok: true });
    }

    const course = data.course || "SIC2026";
    const registered = getChatIds().includes(chatId);

    if (cmd === "/start" || cmd === "/help") {
      await sendMessage(
        chatId,
        `👋 Xin chào <b>${esc(msg.chat.first_name || msg.chat.username || chatId)}</b>!\n\n` +
          `🆔 Chat ID của bạn: <code>${esc(chatId)}</code>\n` +
          (registered
            ? `✅ Đã có trong danh sách nhận thông báo tự động.\n\n`
            : `⚠️ Chưa có trong <b>TELEGRAM_CHAT_IDS</b> trên Vercel.\n` +
              `→ Vercel → Project → Settings → Environment Variables\n` +
              `→ Thêm <code>TELEGRAM_CHAT_IDS=${esc(chatId)}</code> rồi Redeploy.\n\n`) +
          msgHelp()
      );
      const nxt = nextClass(data);
      if (nxt) {
        await sendMessage(chatId, "📌 <b>Buổi học sắp tới:</b>\n\n" + fmtDayShort(nxt));
      }
    } else if (cmd === "/today") {
      const days = todayClasses(data);
      if (!days.length) await sendMessage(chatId, msgTodayNone());
      else {
        for (const d of days) {
          await sendMessage(chatId, "📅 <b>Lịch hôm nay</b>\n\n" + fmtDayShort(d));
        }
      }
    } else if (cmd === "/next") {
      const nxt = nextClass(data);
      if (!nxt) await sendMessage(chatId, "Không còn buổi học nào trong lịch đã xếp.");
      else await sendMessage(chatId, "📌 <b>Buổi học sắp tới</b>\n\n" + fmtDayShort(nxt));
    } else if (cmd === "/week") {
      const vn = nowPartsVN();
      const range = targetWeekRange(vn.iso);
      const days = publishedWeekClasses(data);
      await sendMessage(chatId, msgWeeklyUpdate(days, course, range));
    } else if (cmd === "/test") {
      const days = todayClasses(data);
      const day = days[0] || data.days?.[0];
      const vn = nowPartsVN();
      const range = targetWeekRange(vn.iso);
      await sendMessage(
        chatId,
        "🧪 <b>Test – lịch tuần</b>\n\n" +
          msgWeeklyUpdate(publishedWeekClasses(data), course, range)
      );
      if (day) {
        await sendMessage(chatId, "🧪 <b>Test – thông báo sáng</b>\n\n" + msgMorning(day, course));
        await sendMessage(
          chatId,
          "🧪 <b>Test – nhắc trước 2 giờ (bản chốt)</b>\n\n" + msgPreclass(day, course)
        );
      } else {
        await sendMessage(chatId, "Không có buổi lẻ để test morning/preclass.");
      }
    } else if (cmd === "/status") {
      const vn = nowPartsVN();
      const nxt = nextClass(data);
      const s = data.stats || {};
      await sendMessage(
        chatId,
        "📊 <b>Trạng thái (Vercel)</b>\n" +
          `• Giờ VN: <code>${vn.iso} ${String(vn.hour).padStart(2, "0")}:${String(vn.minute).padStart(2, "0")}</code>\n` +
          `• Buổi xếp lịch: <b>${s.total_days ?? data.days?.length ?? 0}</b>\n` +
          `• Chat ID: <code>${esc(chatId)}</code>\n` +
          `• Nhận cron tự động: <b>${registered ? "Có" : "Chưa (cần TELEGRAM_CHAT_IDS)"}</b>\n` +
          `• Buổi tới: ${esc(nxt?.date || "—")} ${esc(nxt?.time || "")}\n` +
          `• Quy tắc: cập nhật <b>Chủ nhật</b>, đổi đến trước học <b>2h</b>\n` +
          `• Sheet sync: mỗi lần gửi tin (live)`
      );
    } else {
      await sendMessage(chatId, "Không rõ lệnh. Gõ /help");
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(200).json({ ok: false, error: String(e.message || e) });
  }
};
