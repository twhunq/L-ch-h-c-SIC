const API = "https://api.telegram.org";
const { getAllChatIds, envChatIds } = require("./subscribers");

function getToken() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  return token;
}

/** @deprecated dùng getAllChatIds() async – giữ để tương thích */
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
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

/**
 * Gửi tới mọi subscriber (Redis + env).
 * @param {string} text
 * @param {string[]} [chatIds] – nếu bỏ trống sẽ load all
 */
async function broadcast(text, chatIds) {
  const ids = chatIds || (await getAllChatIds());
  const results = [];
  for (const id of ids) {
    try {
      await sendMessage(id, text);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: String(e.message || e) });
      // User chặn bot → gỡ khỏi Redis (nếu có)
      if (String(e.message || "").includes("blocked") || String(e.message || "").includes("deactivated")) {
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
  const payload = {
    url,
    allowed_updates: ["message"],
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

module.exports = {
  getToken,
  getChatIds,
  tg,
  sendMessage,
  broadcast,
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
};
