const API = "https://api.telegram.org";

function getToken() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  return token;
}

function getChatIds() {
  const raw = (process.env.TELEGRAM_CHAT_IDS || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
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

async function broadcast(text, chatIds = getChatIds()) {
  const results = [];
  for (const id of chatIds) {
    try {
      await sendMessage(id, text);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: String(e.message || e) });
    }
  }
  return results;
}

async function setWebhook(url, secret) {
  const payload = { url };
  if (secret) payload.secret_token = secret;
  return tg("setWebhook", payload);
}

async function deleteWebhook() {
  return tg("deleteWebhook", { drop_pending_updates: false });
}

module.exports = {
  getToken,
  getChatIds,
  tg,
  sendMessage,
  broadcast,
  setWebhook,
  deleteWebhook,
};
