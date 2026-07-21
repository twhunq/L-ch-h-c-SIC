/**
 * Gắn webhook Telegram vào production.
 *
 *   https://sicictu.vercel.app/api/setup-webhook?secret=CRON_SECRET
 *   https://sicictu.vercel.app/api/setup-webhook?secret=...&action=info
 *   https://sicictu.vercel.app/api/setup-webhook?secret=...&action=delete
 */
const { setWebhook, deleteWebhook, tg, getWebhookInfo } = require("../lib/telegram");

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
    const me = await tg("getMe");
    const info = await getWebhookInfo();

    return res.status(200).json({
      ok: true,
      action: "set",
      bot: me.username,
      bot_link: `https://t.me/${me.username}`,
      webhook: url,
      result,
      info,
      next: [
        "1) Mở bot_link trên Telegram",
        "2) Gõ /start → đăng ký nhận thông báo",
        "3) Cần lưu nhiều user: bật Upstash Redis (DEPLOY.md)",
        "4) Test: /test hoặc /api/cron?type=test&force=1&secret=...",
      ],
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
