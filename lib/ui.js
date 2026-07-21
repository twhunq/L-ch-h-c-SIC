/**
 * Giao diện Telegram: bàn phím, nút bấm, thẻ tin nhắn.
 */
const WEB_URL = (
  process.env.PUBLIC_BASE_URL ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL ||
  "https://sicictu.vercel.app"
)
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const WEB_HREF = `https://${WEB_URL}`;

/** Nút dưới tin nhắn (inline). */
function inlineMain(extra = {}) {
  const rows = [
    [
      { text: "📅 Hôm nay", callback_data: "nav:today" },
      { text: "📌 Buổi tới", callback_data: "nav:next" },
    ],
    [
      { text: "🗓 Tuần này", callback_data: "nav:week" },
      { text: "🔄 Làm mới", callback_data: "nav:refresh" },
    ],
    [
      { text: "🌐 Mở lịch web", url: WEB_HREF },
      { text: "ℹ️ Trợ giúp", callback_data: "nav:help" },
    ],
  ];
  if (extra.showSubscribe) {
    rows.push([
      { text: "✅ Bật thông báo", callback_data: "nav:start" },
      { text: "🔕 Tắt thông báo", callback_data: "nav:stop" },
    ]);
  } else if (extra.subscribed === true) {
    rows.push([{ text: "🔕 Tắt thông báo", callback_data: "nav:stop" }]);
  } else if (extra.subscribed === false) {
    rows.push([{ text: "✅ Bật thông báo", callback_data: "nav:start" }]);
  }
  return { inline_keyboard: rows };
}

function inlineAfterClass() {
  return {
    inline_keyboard: [
      [
        { text: "📌 Buổi tới", callback_data: "nav:next" },
        { text: "🗓 Tuần này", callback_data: "nav:week" },
      ],
      [
        { text: "🌐 Mở lịch web", url: WEB_HREF },
        { text: "🏠 Menu", callback_data: "nav:menu" },
      ],
    ],
  };
}

function inlineNotify() {
  return {
    inline_keyboard: [
      [
        { text: "📅 Chi tiết hôm nay", callback_data: "nav:today" },
        { text: "🗓 Cả tuần", callback_data: "nav:week" },
      ],
      [{ text: "🌐 Mở lịch web", url: WEB_HREF }],
    ],
  };
}

/** Bàn phím cố định phía dưới chat. */
function replyMenu() {
  return {
    keyboard: [
      [{ text: "📅 Hôm nay" }, { text: "📌 Buổi tới" }],
      [{ text: "🗓 Tuần này" }, { text: "🌐 Xem web" }],
      [{ text: "🏠 Menu" }, { text: "ℹ️ Trợ giúp" }],
      [{ text: "🔕 Tắt báo" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Chọn nút bên dưới hoặc gõ lệnh…",
  };
}

function replyMenuStopped() {
  return {
    keyboard: [
      [{ text: "✅ Bật thông báo" }, { text: "📅 Hôm nay" }],
      [{ text: "📌 Buổi tới" }, { text: "🗓 Tuần này" }],
      [{ text: "🌐 Xem web" }, { text: "ℹ️ Trợ giúp" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Map text nút reply → action */
function mapTextToAction(text) {
  const t = (text || "").trim();
  const table = {
    "📅 hôm nay": "today",
    "hôm nay": "today",
    "📌 buổi tới": "next",
    "buổi tới": "next",
    "🗓 tuần này": "week",
    "tuần này": "week",
    "🌐 xem web": "web",
    "xem web": "web",
    "🏠 menu": "menu",
    menu: "menu",
    "ℹ️ trợ giúp": "help",
    "trợ giúp": "help",
    "🔕 tắt báo": "stop",
    "tắt báo": "stop",
    "tắt thông báo": "stop",
    "✅ bật thông báo": "start",
    "bật thông báo": "start",
    "/start": "start",
    "/stop": "stop",
    "/today": "today",
    "/next": "next",
    "/week": "week",
    "/help": "help",
    "/menu": "menu",
    "/status": "status",
    "/test": "test",
    "/web": "web",
  };
  // exact
  if (table[t.toLowerCase()]) return table[t.toLowerCase()];
  // command form
  if (t.startsWith("/")) {
    const cmd = t.split(/\s+/)[0].split("@")[0].toLowerCase();
    return table[cmd] || cmd.replace(/^\//, "");
  }
  // fuzzy contains
  const low = t.toLowerCase();
  if (low.includes("hôm nay") || low.includes("hom nay")) return "today";
  if (low.includes("buổi tới") || low.includes("buoi toi") || low.includes("next")) return "next";
  if (low.includes("tuần") || low.includes("tuan")) return "week";
  if (low.includes("web") || low.includes("trang")) return "web";
  if (low.includes("help") || low.includes("trợ") || low.includes("tro giup")) return "help";
  if (low.includes("menu") || low.includes("bắt đầu") || low.includes("bat dau")) return "menu";
  if (low.includes("tắt") || low.includes("tat")) return "stop";
  if (low.includes("bật") || low.includes("bat thong")) return "start";
  return null;
}

function divider() {
  return "────────────────";
}

function header(emoji, title) {
  return `${emoji} <b>${title}</b>\n${divider()}`;
}

const BOT_COMMANDS = [
  { command: "start", description: "Mở menu & bật thông báo" },
  { command: "today", description: "Lịch học hôm nay" },
  { command: "next", description: "Buổi học sắp tới" },
  { command: "week", description: "Lịch cả tuần" },
  { command: "web", description: "Mở trang lịch trên web" },
  { command: "status", description: "Trạng thái đăng ký" },
  { command: "stop", description: "Tắt thông báo" },
  { command: "help", description: "Hướng dẫn sử dụng" },
];

module.exports = {
  WEB_HREF,
  WEB_URL,
  inlineMain,
  inlineAfterClass,
  inlineNotify,
  replyMenu,
  replyMenuStopped,
  mapTextToAction,
  divider,
  header,
  BOT_COMMANDS,
};
