/**
 * Telegram Webhook – /start đăng ký nhận thông báo cho MỌI user.
 * Gắn webhook: GET /api/setup-webhook?secret=CRON_SECRET
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
const { sendMessage } = require("../lib/telegram");
const {
  addSubscriber,
  removeSubscriber,
  isSubscribed,
  subscriberStats,
  redisConfigured,
} = require("../lib/subscribers");

function checkSecret(req) {
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  // Không set secret → luôn cho qua (khuyên dùng khi mới setup)
  if (!secret) return true;
  const header =
    req.headers["x-telegram-bot-api-secret-token"] ||
    req.headers["X-Telegram-Bot-Api-Secret-Token"];
  return header === secret;
}

function parseUpdate(req) {
  let body = req.body;
  if (body == null) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body || "{}");
    } catch {
      return {};
    }
  }
  return body;
}

module.exports = async function handler(req, res) {
  // Telegram chỉ POST; GET để kiểm tra sống
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "telegram-webhook",
      hint: "Webhook sẵn sàng. Gọi /api/setup-webhook để gắn bot.",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!checkSecret(req)) {
    console.error("webhook: secret mismatch – xóa TELEGRAM_WEBHOOK_SECRET hoặc chạy lại setup-webhook");
    // Vẫn 200 để Telegram không spam retry quá mức; không xử lý
    return res.status(200).json({ ok: false, error: "bad secret" });
  }

  try {
    const update = parseUpdate(req);
    const msg = update.message || update.edited_message;
    if (!msg?.chat?.id) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const chatId = String(msg.chat.id);
    const text = (msg.text || msg.caption || "").trim();
    const name = msg.chat.first_name || msg.chat.username || chatId;

    // Không phải lệnh → gợi ý
    if (!text.startsWith("/")) {
      try {
        await sendMessage(
          chatId,
          "🤖 Gõ <b>/start</b> để đăng ký nhận lịch học.\n/help · /today · /next · /week · /stop"
        );
      } catch (e) {
        console.error("sendMessage", e);
      }
      return res.status(200).json({ ok: true });
    }

    const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();

    // ─── /start: đăng ký ngay, không phụ thuộc Sheet ───
    if (cmd === "/start") {
      let reg;
      try {
        reg = await addSubscriber(chatId);
      } catch (e) {
        console.error("addSubscriber", e);
        reg = { ok: false, stored: false, reason: String(e.message || e) };
      }

      let body =
        `👋 Xin chào <b>${esc(name)}</b>!\n\n` +
        `🆔 Chat ID: <code>${esc(chatId)}</code>\n`;

      if (reg.stored) {
        body +=
          `✅ <b>Đã đăng ký nhận thông báo lịch học.</b>\n` +
          `Bạn sẽ nhận tin cùng mọi người dùng bot khác.\n\n`;
      } else if (!redisConfigured()) {
        body +=
          `⚠️ Bot chưa bật kho lưu subscriber (Upstash Redis).\n` +
          `Admin cần thêm Upstash trên Vercel (xem DEPLOY.md) để lưu danh sách user.\n` +
          `Tạm thời chỉ env TELEGRAM_CHAT_IDS nhận tin.\n\n`;
      } else {
        body += `⚠️ Đăng ký Redis lỗi: ${esc(reg.reason || "unknown")}\n\n`;
      }

      body += msgHelp();

      try {
        await sendMessage(chatId, body);
      } catch (e) {
        console.error("start send", e);
        return res.status(200).json({ ok: false, error: String(e.message || e) });
      }

      // Buổi tới (nếu Sheet đọc được)
      try {
        const data = await fetchSchedule();
        const nxt = nextClass(data);
        if (nxt) {
          await sendMessage(chatId, "📌 <b>Buổi học sắp tới:</b>\n\n" + fmtDayShort(nxt));
        }
      } catch (e) {
        console.error("schedule on start", e);
      }

      return res.status(200).json({ ok: true, cmd: "start", chatId, reg });
    }

    if (cmd === "/stop") {
      try {
        await removeSubscriber(chatId);
      } catch (e) {
        console.error(e);
      }
      await sendMessage(
        chatId,
        "🔕 Đã <b>hủy đăng ký</b> thông báo.\nGõ /start nếu muốn bật lại."
      );
      return res.status(200).json({ ok: true, cmd: "stop" });
    }

    if (cmd === "/help") {
      await sendMessage(chatId, msgHelp());
      return res.status(200).json({ ok: true, cmd: "help" });
    }

    // Các lệnh còn lại cần lịch
    let data;
    try {
      data = await fetchSchedule();
    } catch (e) {
      await sendMessage(chatId, `❌ Không tải được lịch: ${esc(e.message)}`);
      return res.status(200).json({ ok: true });
    }

    const course = data.course || "SIC2026";
    const registered = await isSubscribed(chatId);

    if (cmd === "/today") {
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
      await sendMessage(chatId, msgWeeklyUpdate(publishedWeekClasses(data), course, range));
    } else if (cmd === "/test") {
      const days = todayClasses(data);
      const day = days[0] || data.days?.[0];
      const vn = nowPartsVN();
      await sendMessage(
        chatId,
        "🧪 <b>Test – lịch tuần</b>\n\n" +
          msgWeeklyUpdate(publishedWeekClasses(data), course, targetWeekRange(vn.iso))
      );
      if (day) {
        await sendMessage(chatId, "🧪 <b>Test – morning</b>\n\n" + msgMorning(day, course));
        await sendMessage(chatId, "🧪 <b>Test – preclass</b>\n\n" + msgPreclass(day, course));
      }
    } else if (cmd === "/status") {
      const vn = nowPartsVN();
      const nxt = nextClass(data);
      const s = data.stats || {};
      const stats = await subscriberStats();
      await sendMessage(
        chatId,
        "📊 <b>Trạng thái bot</b>\n" +
          `• Giờ VN: <code>${vn.iso} ${String(vn.hour).padStart(2, "0")}:${String(vn.minute).padStart(2, "0")}</code>\n` +
          `• Bạn đã đăng ký: <b>${registered ? "Có ✅" : "Chưa – gõ /start"}</b>\n` +
          `• Tổng người nhận: <b>${stats.total}</b> (Redis ${stats.redisCount} + env ${stats.envCount})\n` +
          `• Redis: <b>${stats.redisConfigured ? "ON" : "OFF"}</b>\n` +
          `• Buổi xếp lịch: <b>${s.total_days ?? data.days?.length ?? 0}</b>\n` +
          `• Buổi tới: ${esc(nxt?.date || "—")} ${esc(nxt?.time || "")}\n` +
          `• Chat ID: <code>${esc(chatId)}</code>`
      );
    } else {
      await sendMessage(chatId, "Không rõ lệnh. Gõ /help hoặc /start");
    }

    return res.status(200).json({ ok: true, cmd });
  } catch (e) {
    console.error("webhook error", e);
    return res.status(200).json({ ok: false, error: String(e.message || e) });
  }
};
