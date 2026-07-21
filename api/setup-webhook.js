/**
 * Gắn webhook Telegram vào production.
 *
 *   https://sicictu.vercel.app/api/setup-webhook?secret=CRON_SECRET
 *   https://sicictu.vercel.app/api/setup-webhook?secret=...&action=info
 *   https://sicictu.vercel.app/api/setup-webhook?secret=...&action=delete
 */
const {
  setWebhook,
  deleteWebhook,
  tg,
  getWebhookInfo,
  setupBotUi,
} = require("../lib/telegram");

module.exports = async function handler(req, res) {
  const secret = (process.env.CRON_SECRET || "").trim();
  const auth = req.headers.authorization || "";
  const q = req.query || {};
  const ok =
    (!secret && !process.env.VERCEL) ||
    (secret && auth === `Bearer ${secret}`) ||
    (secret && (q.secret === secret || q.key === secret));

  if (!ok) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized – thêm ?secret=CRON_SECRET (trùng env trên Vercel)",
    });
  }

  const action = (q.action || "set").toLowerCase();

  try {
    if (action === "info") {
      const info = await getWebhookInfo();
      const me = await tg("getMe");
      return res.status(200).json({ ok: true, action: "info", bot: me.username, info });
    }

    if (action === "delete") {
      const result = await deleteWebhook();
      return res.status(200).json({ ok: true, action: "delete", result });
    }

    // Ưu tiên domain production cố định nếu có
    const forced =
      (process.env.PUBLIC_BASE_URL || "").trim() ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
    let host = forced || process.env.VERCEL_URL || req.headers.host || "sicictu.vercel.app";
    // Bỏ protocol nếu user dán full URL
    host = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const url = `https://${host}/api/webhook`;

    // Không dùng secret_token trừ khi bật rõ WEBHOOK_USE_SECRET=1
    // (tránh /start im lặng vì secret lệch)
    const useSecret = process.env.WEBHOOK_USE_SECRET === "1";
    const hookSecret = useSecret
      ? (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim()
      : "";

    const result = await setWebhook(url, hookSecret || undefined);
    let ui = null;
    try {
      ui = await setupBotUi();
    } catch (e) {
      ui = { error: String(e.message || e) };
    }
    const me = await tg("getMe");
    const info = await getWebhookInfo();

    return res.status(200).json({
      ok: true,
      action: "set",
      bot: me.username,
      bot_link: `https://t.me/${me.username}`,
      webhook: url,
      result,
      ui,
      info,
      next: [
        "1) Mở bot_link trên Telegram",
        "2) Gõ /start → menu nút bấm + đăng ký thông báo",
        "3) Dùng nút: Hôm nay · Buổi tới · Tuần · Web",
        "4) Upstash Redis để lưu nhiều user (DEPLOY.md)",
      ],
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
