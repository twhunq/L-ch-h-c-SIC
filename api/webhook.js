/**
 * Telegram Webhook – UI nút bấm + đăng ký multi-user.
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
  esc,
} = require("../lib/messages");
const {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
} = require("../lib/telegram");
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

async function handleAction(action, ctx) {
  const { chatId, name, messageId, isCallback } = ctx;
  const send = async (text, markup) => {
    if (isCallback && messageId) {
      await editMessageText(chatId, messageId, text, {
        reply_markup: markup || inlineMain({ subscribed: await isSubscribed(chatId) }),
      });
    } else {
      await sendMessage(chatId, text, {
        reply_markup: markup || inlineMain({ subscribed: await isSubscribed(chatId) }),
      });
    }
  };

  // ── start / menu ──
  if (action === "start" || action === "menu") {
    let reg = { stored: false };
    if (action === "start") {
      try {
        reg = await addSubscriber(chatId);
      } catch (e) {
        reg = { stored: false, reason: String(e.message || e) };
      }
    }
    const registered = action === "start" ? !!reg.stored || (await isSubscribed(chatId)) : await isSubscribed(chatId);
    const data = await loadScheduleSafe();
    const course = data?.course || "SIC2026 ICTU";
    const nxt = data ? nextClass(data) : null;

    if (action === "start") {
      const text = msgWelcome(name, {
        registered,
        redisOk: redisConfigured(),
        nextDay: nxt,
        course,
      });
      await sendMessage(chatId, text, {
        reply_markup: replyMenu(),
      });
      await sendMessage(chatId, msgMenu({
        registered,
        nextSummary: nxt ? `${nxt.date} · ${nxt.time || ""}` : "",
      }), {
        reply_markup: inlineMain({ subscribed: registered }),
      });
      return { ok: true, action, registered };
    }

    // menu
    await send(
      msgMenu({
        registered,
        nextSummary: nxt ? `${nxt.date} · ${nxt.time || ""}` : "",
      }),
      inlineMain({ subscribed: registered })
    );
    // đảm bảo có reply keyboard
    if (!isCallback) {
      await sendMessage(chatId, "👇 Chọn nút bên dưới màn hình", {
        reply_markup: registered ? replyMenu() : replyMenuStopped(),
      });
    }
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
    await sendMessage(chatId, "Bạn vẫn xem lịch bằng nút bên dưới.", {
      reply_markup: inlineMain({ subscribed: false }),
    });
    return { ok: true, action: "stop" };
  }

  if (action === "help") {
    await send(msgHelp(), inlineMain({ subscribed: await isSubscribed(chatId) }));
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

  // schedule actions
  const data = await loadScheduleSafe();
  if (!data) {
    await sendMessage(
      chatId,
      "❌ Không tải được lịch từ Google Sheet.\nThử lại sau hoặc mở web: " + WEB_HREF,
      { reply_markup: inlineMain({ subscribed: await isSubscribed(chatId) }) }
    );
    return { ok: false, action };
  }

  const course = data.course || "SIC2026";
  const registered = await isSubscribed(chatId);

  if (action === "today") {
    const days = todayClasses(data);
    await send(msgToday(days), inlineAfterClass());
    return { ok: true, action: "today" };
  }

  if (action === "next") {
    const nxt = nextClass(data);
    await send(msgNext(nxt), inlineAfterClass());
    return { ok: true, action: "next" };
  }

  if (action === "week" || action === "refresh") {
    const vn = nowPartsVN();
    const range = targetWeekRange(vn.iso);
    const days = publishedWeekClasses(data);
    await send(msgWeeklyUpdate(days, course, range), inlineAfterClass());
    return { ok: true, action };
  }

  if (action === "status") {
    const vn = nowPartsVN();
    const stats = await subscriberStats();
    await send(
      msgStatus({
        registered,
        stats,
        nextDay: nextClass(data),
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
    await sendMessage(
      chatId,
      "🧪 <b>Xem thử thông báo</b>\n\n" +
        msgWeeklyUpdate(publishedWeekClasses(data), course, targetWeekRange(vn.iso)),
      { reply_markup: inlineAfterClass() }
    );
    if (day) {
      await sendMessage(chatId, msgMorning(day, course), {
        reply_markup: inlineAfterClass(),
      });
      await sendMessage(chatId, msgPreclass(day, course), {
        reply_markup: inlineAfterClass(),
      });
    }
    return { ok: true, action: "test" };
  }

  await send(
    "🤔 Không rõ yêu cầu.\nBấm <b>🏠 Menu</b> hoặc chọn nút bên dưới.",
    inlineMain({ subscribed: registered })
  );
  return { ok: true, action: "unknown" };
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "telegram-webhook-ui",
      web: WEB_HREF,
    });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }
  if (!checkSecret(req)) {
    return res.status(200).json({ ok: false, error: "bad secret" });
  }

  try {
    const update = parseUpdate(req);

    // ── Inline button callbacks ──
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = String(cq.message?.chat?.id || cq.from?.id || "");
      const messageId = cq.message?.message_id;
      const name = cq.from?.first_name || cq.from?.username || chatId;
      const data = (cq.data || "").trim();
      const action = data.startsWith("nav:") ? data.slice(4) : data;

      await answerCallbackQuery(cq.id, actionLabel(action));
      const result = await handleAction(action, {
        chatId,
        name,
        messageId,
        isCallback: true,
      });
      return res.status(200).json({ ok: true, type: "callback", ...result });
    }

    const msg = update.message || update.edited_message;
    if (!msg?.chat?.id) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const chatId = String(msg.chat.id);
    const text = (msg.text || msg.caption || "").trim();
    const name = msg.from?.first_name || msg.chat.first_name || msg.chat.username || chatId;

    // WebApp data (nếu có)
    if (msg.web_app_data) {
      await sendMessage(chatId, "✅ Đã nhận dữ liệu từ web app.", {
        reply_markup: replyMenu(),
      });
      return res.status(200).json({ ok: true, type: "web_app" });
    }

    let action = mapTextToAction(text);
    if (!action && text) {
      // mặc định mở menu nếu chat linh tinh
      action = "menu";
    }
    if (!text) {
      action = "menu";
    }

    // /start luôn đăng ký
    if (text.toLowerCase().startsWith("/start")) {
      action = "start";
    }

    const result = await handleAction(action, {
      chatId,
      name,
      messageId: null,
      isCallback: false,
    });
    return res.status(200).json({ ok: true, type: "message", ...result });
  } catch (e) {
    console.error("webhook error", e);
    return res.status(200).json({ ok: false, error: String(e.message || e) });
  }
};

function actionLabel(a) {
  const map = {
    today: "📅 Hôm nay",
    next: "📌 Buổi tới",
    week: "🗓 Tuần này",
    menu: "🏠 Menu",
    help: "ℹ️ Trợ giúp",
    start: "✅ Đã bật",
    stop: "🔕 Đã tắt",
    refresh: "🔄 Làm mới",
    web: "🌐 Web",
    status: "📊 Status",
  };
  return map[a] || "OK";
}
