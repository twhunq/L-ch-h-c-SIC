const { nowPartsVN } = require("../lib/schedule");
const { getChatIds } = require("../lib/telegram");

module.exports = async function handler(req, res) {
  const vn = nowPartsVN();
  res.status(200).json({
    ok: true,
    service: "lich-hoc-sic2026",
    vn,
    hasToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    chatCount: getChatIds().length,
    crons: [
      { type: "morning+weekly_sunday", utc: "01:00", vn: "08:00" },
      { type: "preclass_final", utc: "09:00", vn: "16:00 (trước học 18:00 2h)" },
    ],
    policy: {
      sheet_weekly_update: "Chủ nhật",
      last_change_before_class_hours: 2,
      always_live_fetch: true,
    },
  });
};
