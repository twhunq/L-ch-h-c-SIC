const { nowPartsVN } = require("../lib/schedule");
const { subscriberStats, redisConfigured } = require("../lib/subscribers");

module.exports = async function handler(req, res) {
  const vn = nowPartsVN();
  let stats = {
    redisConfigured: redisConfigured(),
    redisCount: 0,
    envCount: 0,
    total: 0,
  };
  try {
    stats = await subscriberStats();
  } catch (e) {
    stats.error = String(e.message || e);
  }

  res.status(200).json({
    ok: true,
    service: "lich-hoc-sic2026",
    vn,
    hasToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    chatCount: stats.total,
    subscribers: stats,
    redis: stats.redisConfigured,
    crons: [
      { type: "morning+weekly_sunday", utc: "01:00", vn: "08:00" },
      { type: "preclass_final", utc: "09:00", vn: "16:00 (trước học 18:00 2h)" },
    ],
    policy: {
      sheet_weekly_update: "Chủ nhật",
      last_change_before_class_hours: 2,
      always_live_fetch: true,
      multi_user: "Upstash Redis SADD on /start",
    },
    setup: {
      webhook: "https://sicictu.vercel.app/api/setup-webhook?secret=CRON_SECRET",
      webhook_info:
        "https://sicictu.vercel.app/api/setup-webhook?secret=CRON_SECRET&action=info",
    },
  });
};
