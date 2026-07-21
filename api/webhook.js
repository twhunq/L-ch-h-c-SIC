/**
 * Telegram Webhook – UI nút bấm (inline + reply keyboard).
 * Bấm nút → luôn gửi tin nhắn mới (ổn định hơn editMessage).
 */
const {
  fetchSchedule,
  todayClasses,
  classFocus,
  upcomingClass,
  publishedWeekClasses,
  targetWeekRange,
  nowPartsVN,
} = require("../lib/schedule");
const {
  msgWelcome,
  msgMenu,
  msgHelp,
  msgToday,
  msgNext,
  msgWeeklyUpdate,
  msgStopped,
  msgStatus,
  msgMorning,
  msgPreclass,
  focusLineFrom,
} = require("../lib/messages");
const { sendMessage, answerCallbackQuery } = require("../lib/telegram");
const {
  addSubscriber,
  removeSubscriber,
  isSubscribed,
  subscriberStats,
  redisConfigured,
} = require("../lib/subscribers");
const {
  WEB_HREF,
  inlineMain,
  inlineAfterClass,
  replyMenu,
  replyMenuStopped,
  mapTextToAction,
} = require("../lib/ui");

function checkSecret(req) {
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (!secret) return true;
  const header =
    req.headers["x-telegram-bot-api-secret-token"] ||
    req.headers["X-Telegram-Bot-Api-Secret-Token"];
  return header === secret;
}

function parseUpdate(req) {
  let body = req.body;
  if (body == null) return {};
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString("utf8") || "{}");
    } catch {
      return {};
    }
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body || "{}");
    } catch {
      return {};
    }
  }
  return body;
}

async function loadScheduleSafe() {
  try {
    return await fetchSchedule();
  } catch (e) {
    console.error("fetchSchedule", e);
    return null;
  }
}

/** Luôn gửi tin MỚI — user luôn thấy phản hồi khi bấm nút. */
async function reply(chatId, text, markup) {
  const registered = await isSubscribed(chatId).catch(() => false);
  return sendMessage(chatId, text, {
    reply_markup: markup || inlineMain({ subscribed: registered }),
  });
}

async function handleAction(action, ctx) {
  const { chatId, name } = ctx;

  // ── start ──
  if (action === "start") {
    let reg = { stored: false };
    try {
      reg = await addSubscriber(chatId);
    } catch (e) {
      reg = { stored: false, reason: String(e.message || e) };
    }
    const registered = !!reg.stored || (await isSubscribed(chatId).catch(() => false));
    const data = await loadScheduleSafe();
    const course = data?.course || "SIC2026 ICTU";
    const focus = data ? classFocus(data) : null;

    await sendMessage(
      chatId,
      msgWelcome(name, {
        registered,
        redisOk: redisConfigured(),
        focus,
        course,
      }),
      { reply_markup: registered ? replyMenu() : replyMenuStopped() }
    );
    await sendMessage(
      chatId,
      msgMenu({
        registered,
        focusLine: focusLineFrom(focus),
      }),
      { reply_markup: inlineMain({ subscribed: registered }) }
    );
    return { ok: true, action, registered };
  }

  // ── menu ──
  if (action === "menu") {
    const registered = await isSubscribed(chatId).catch(() => false);
    const data = await loadScheduleSafe();
    const focus = data ? classFocus(data) : null;
    await sendMessage(
      chatId,
      msgMenu({
        registered,
        focusLine: focusLineFrom(focus),
      }),
      { reply_markup: inlineMain({ subscribed: registered }) }
    );
    await sendMessage(chatId, "👇 Chọn nút bên dưới hoặc bấm các nút trong tin nhắn", {
      reply_markup: registered ? replyMenu() : replyMenuStopped(),
    });
    return { ok: true, action };
  }

  if (action === "stop") {
    try {
      await removeSubscriber(chatId);
    } catch (e) {
      console.error(e);
    }
    await sendMessage(chatId, msgStopped(), {
      reply_markup: replyMenuStopped(),
    });
    await reply(chatId, "Bạn vẫn xem lịch bằng nút bên dưới.", inlineMain({ subscribed: false }));
    return { ok: true, action: "stop" };
  }

  if (action === "help") {
    await reply(chatId, msgHelp(), inlineMain({ subscribed: await isSubscribed(chatId).catch(() => false) }));
    return { ok: true, action: "help" };
  }

  if (action === "web") {
    await sendMessage(
      chatId,
      `🌐 <b>Lịch học đầy đủ trên web</b>\n\n` +
        `👉 <a href="${WEB_HREF}">${WEB_HREF}</a>\n\n` +
        `Xem theo tuần · điểm danh · chi tiết tiết học.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🌐 Mở trang lịch", url: WEB_HREF }],
            [
              { text: "📅 Hôm nay", callback_data: "nav:today" },
              { text: "🏠 Menu", callback_data: "nav:menu" },
            ],
          ],
        },
        disable_web_page_preview: false,
      }
    );
    return { ok: true, action: "web" };
  }

  const data = await loadScheduleSafe();
  if (!data) {
    await reply(
      chatId,
      "❌ Không tải được lịch từ Google Sheet.\nThử lại sau hoặc mở web:\n" + WEB_HREF
    );
    return { ok: false, action, error: "sheet" };
  }

  const course = data.course || "SIC2026";
  const registered = await isSubscribed(chatId).catch(() => false);

  if (action === "today") {
    const days = todayClasses(data);
    await reply(chatId, msgToday(days), inlineAfterClass());
    return { ok: true, action: "today" };
  }

  if (action === "next") {
    // "Buổi tới" = buổi CHƯA bắt đầu (không phải buổi đang học)
    const focus = classFocus(data);
    const upcoming = upcomingClass(data);
    await reply(chatId, msgNext(upcoming, focus), inlineAfterClass());
    return {
      ok: true,
      action: "next",
      status: focus.status,
      upcoming: upcoming?.date || null,
    };
  }

  if (action === "week" || action === "refresh") {
    const vn = nowPartsVN();
    const range = targetWeekRange(vn.iso);
    const days = publishedWeekClasses(data);
    await reply(chatId, msgWeeklyUpdate(days, course, range), inlineAfterClass());
    return { ok: true, action };
  }

  if (action === "status") {
    const vn = nowPartsVN();
    const stats = await subscriberStats();
    await reply(
      chatId,
      msgStatus({
        registered,
        stats,
        focus: classFocus(data),
        vn,
        chatId,
      }),
      inlineMain({ subscribed: registered })
    );
    return { ok: true, action: "status" };
  }

  if (action === "test") {
    const days = todayClasses(data);
    const day = days[0] || data.days?.[0];
    const vn = nowPartsVN();
    await reply(
      chatId,
      "🧪 <b>Xem thử thông báo</b>\n\n" +
        msgWeeklyUpdate(publishedWeekClasses(data), course, targetWeekRange(vn.iso)),
      inlineAfterClass()
    );
    if (day) {
      await reply(chatId, msgMorning(day, course), inlineAfterClass());
      await reply(chatId, msgPreclass(day, course), inlineAfterClass());
    }
    return { ok: true, action: "test" };
  }

  await reply(
    chatId,
    "🤔 Không rõ yêu cầu.\nBấm <b>🏠 Menu</b> hoặc chọn nút bên dưới.\n\nHoặc gõ: /today /next /week /help"
  );
  return { ok: true, action: "unknown", raw: action };
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "telegram-webhook-ui",
      web: WEB_HREF,
      hint: "POST from Telegram. Re-run /api/setup-webhook if buttons don't work.",
    });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }
  if (!checkSecret(req)) {
    console.error("webhook bad secret");
    return res.status(200).json({ ok: false, error: "bad secret" });
  }

  try {
    const update = parseUpdate(req);
    console.log(
      "update keys:",
      Object.keys(update || {}),
      "cb:",
      !!update.callback_query,
      "msg:",
      !!update.message
    );

    // ── Inline buttons ──
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = String(cq.message?.chat?.id || cq.from?.id || "");
      const name = cq.from?.first_name || cq.from?.username || chatId;
      const raw = (cq.data || "").trim();
      const action = raw.startsWith("nav:") ? raw.slice(4) : raw;

      // Trả lời callback ngay (bỏ loading trên nút)
      try {
        await answerCallbackQuery(cq.id, actionLabel(action));
      } catch (e) {
        console.error("answerCallback", e);
      }

      try {
        const result = await handleAction(action || "menu", {
          chatId,
          name,
          isCallback: true,
        });
        return res.status(200).json({ ok: true, type: "callback", action, ...result });
      } catch (e) {
        console.error("callback handle", e);
        try {
          await sendMessage(
            chatId,
            "⚠️ Lỗi khi xử lý nút: " + String(e.message || e).slice(0, 200) + "\nThử gõ /today"
          );
        } catch (_) {}
        return res.status(200).json({ ok: false, error: String(e.message || e) });
      }
    }

    const msg = update.message || update.edited_message;
    if (!msg?.chat?.id) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const chatId = String(msg.chat.id);
    const text = (msg.text || msg.caption || "").trim();
    const name =
      msg.from?.first_name || msg.chat.first_name || msg.chat.username || chatId;

    if (msg.web_app_data) {
      await sendMessage(chatId, "✅ Đã nhận dữ liệu từ web app.", {
        reply_markup: replyMenu(),
      });
      return res.status(200).json({ ok: true, type: "web_app" });
    }

    let action = mapTextToAction(text);
    if (text && text.toLowerCase().startsWith("/start")) action = "start";
    if (!action) action = text ? "menu" : "menu";

    try {
      const result = await handleAction(action, {
        chatId,
        name,
        isCallback: false,
      });
      return res.status(200).json({ ok: true, type: "message", action, ...result });
    } catch (e) {
      console.error("message handle", e);
      try {
        await sendMessage(
          chatId,
          "⚠️ Có lỗi: " + String(e.message || e).slice(0, 200) + "\nThử /start lại."
        );
      } catch (_) {}
      return res.status(200).json({ ok: false, error: String(e.message || e) });
    }
  } catch (e) {
    console.error("webhook error", e);
    return res.status(200).json({ ok: false, error: String(e.message || e) });
  }
};

function actionLabel(a) {
  const map = {
    today: "📅 Đang tải…",
    next: "📌 Đang tải…",
    week: "🗓 Đang tải…",
    menu: "🏠 Menu",
    help: "ℹ️ Trợ giúp",
    start: "✅ OK",
    stop: "🔕 OK",
    refresh: "🔄 Đang tải…",
    web: "🌐 Web",
    status: "📊 Status",
  };
  return map[a] || "OK";
}
