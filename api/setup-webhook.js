/**
 * Gọi 1 lần sau khi deploy để gắn Telegram webhook:
 *   GET /api/setup-webhook?secret=CRON_SECRET
 *   (hoặc Bearer CRON_SECRET)
 */
const { setWebhook, deleteWebhook, tg } = require("../lib/telegram");

module.exports = async function handler(req, res) {
  const secret = (process.env.CRON_SECRET || "").trim();
  const auth = req.headers.authorization || "";
  const q = req.query || {};
  const ok =
    (!secret && !process.env.VERCEL) ||
    (secret && auth === `Bearer ${secret}`) ||
    (secret && (q.secret === secret || q.key === secret));

  if (!ok) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const action = (q.action || "set").toLowerCase();
  try {
    if (action === "delete") {
      const result = await deleteWebhook();
      return res.status(200).json({ ok: true, action: "delete", result });
    }

    const host =
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_URL ||
      req.headers.host;
    if (!host) {
      return res.status(400).json({ ok: false, error: "Không xác định được domain" });
    }
    const base = host.startsWith("http") ? host : `https://${host}`;
    const url = `${base.replace(/\/$/, "")}/api/webhook`;
    const hookSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
    const result = await setWebhook(url, hookSecret || undefined);
    const me = await tg("getMe");
    return res.status(200).json({
      ok: true,
      action: "set",
      webhook: url,
      bot: me.username,
      result,
      next: "Mở bot Telegram → /start → copy Chat ID vào TELEGRAM_CHAT_IDS trên Vercel → Redeploy",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
