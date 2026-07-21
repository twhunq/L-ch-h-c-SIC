const API = "https://api.telegram.org";
const { getAllChatIds, envChatIds } = require("./subscribers");
const { BOT_COMMANDS, inlineNotify } = require("./ui");

function getToken() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  return token;
}

function getChatIds() {
  return envChatIds();
}

async function tg(method, payload) {
  const token = getToken();
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    const desc = body.description || res.statusText;
    throw new Error(`Telegram ${method}: ${desc}`);
  }
  return body.result;
}

async function sendMessage(chatId, text, extra = {}) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  };
  // Telegram limit ~4096
  if (payload.text && payload.text.length > 4000) {
    payload.text = payload.text.slice(0, 3990) + "…";
  }
  return tg("sendMessage", payload);
}

async function editMessageText(chatId, messageId, text, extra = {}) {
  try {
    return await tg("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: text.length > 4000 ? text.slice(0, 3990) + "…" : text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    });
  } catch (e) {
    // message not modified / too old → gửi mới
    if (String(e.message || "").includes("message is not modified")) return null;
    return sendMessage(chatId, text, extra);
  }
}

async function answerCallbackQuery(id, text, showAlert = false) {
  try {
    return await tg("answerCallbackQuery", {
      callback_query_id: id,
      text: text || undefined,
      show_alert: showAlert,
    });
  } catch (e) {
    console.error("answerCallbackQuery", e.message);
    return null;
  }
}

async function broadcast(text, chatIds, extra = {}) {
  const ids = chatIds || (await getAllChatIds());
  const markup = extra.reply_markup || inlineNotify();
  const results = [];
  for (const id of ids) {
    try {
      await sendMessage(id, text, { reply_markup: markup });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: String(e.message || e) });
      const err = String(e.message || "");
      if (err.includes("blocked") || err.includes("deactivated") || err.includes("chat not found")) {
        try {
          const { removeSubscriber } = require("./subscribers");
          await removeSubscriber(id);
        } catch (_) {}
      }
    }
  }
  return results;
}

async function setWebhook(url, secret) {
  // Phải có callback_query — nếu thiếu thì bấm nút inline sẽ không có phản hồi
  const payload = {
    url,
    allowed_updates: ["message", "callback_query", "edited_message"],
    drop_pending_updates: true,
  };
  if (secret) payload.secret_token = secret;
  return tg("setWebhook", payload);
}

async function deleteWebhook() {
  return tg("deleteWebhook", { drop_pending_updates: true });
}

async function getWebhookInfo() {
  return tg("getWebhookInfo");
}

async function setupBotUi() {
  await tg("setMyCommands", { commands: BOT_COMMANDS });
  try {
    await tg("setMyDescription", {
      description:
        "Bot lịch học SIC2026 ICTU – Samsung Innovation Campus.\n" +
        "Nhận thông báo tự động 8h sáng & trước giờ học 2 tiếng.\n" +
        "Bấm /start để mở menu nút bấm dễ dùng.",
    });
  } catch (_) {}
  try {
    await tg("setMyShortDescription", {
      short_description: "Lịch học SIC2026 · Thông báo tự động · Menu nút bấm",
    });
  } catch (_) {}
  try {
    const web =
      process.env.PUBLIC_BASE_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      "https://sicictu.vercel.app";
    const href = web.startsWith("http") ? web : `https://${web}`;
    await tg("setChatMenuButton", {
      menu_button: {
        type: "web_app",
        text: "Lịch web",
        web_app: { url: href.replace(/\/$/, "") + "/" },
      },
    });
  } catch (_) {
    // fallback default menu
    try {
      await tg("setChatMenuButton", { menu_button: { type: "commands" } });
    } catch (__) {}
  }
  return { commands: BOT_COMMANDS.length };
}

module.exports = {
  getToken,
  getChatIds,
  tg,
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  broadcast,
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  setupBotUi,
};
