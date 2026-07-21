/**
 * Danh sách người nhận thông báo.
 *
 * Nguồn:
 *  1) Ai /start bot → lưu vào Upstash Redis (miễn phí)
 *  2) TELEGRAM_CHAT_IDS trong env (admin / seed)
 *
 * Upstash: Vercel → Storage → Create → Upstash Redis
 * Tự có: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 */
const SET_KEY = "sic2026:subscribers";

function envChatIds() {
  const raw = (process.env.TELEGRAM_CHAT_IDS || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function redisConfigured() {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL || "").trim() &&
      (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim()
  );
}

async function redis(...command) {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!url || !token) {
    throw new Error("Upstash Redis chưa cấu hình");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `Redis HTTP ${res.status}`);
  }
  return data.result;
}

async function addSubscriber(chatId) {
  const id = String(chatId);
  if (!redisConfigured()) {
    return { ok: false, stored: false, reason: "no_redis", id };
  }
  await redis("SADD", SET_KEY, id);
  return { ok: true, stored: true, id };
}

async function removeSubscriber(chatId) {
  const id = String(chatId);
  if (!redisConfigured()) {
    return { ok: false, stored: false, reason: "no_redis", id };
  }
  await redis("SREM", SET_KEY, id);
  return { ok: true, stored: true, id };
}

async function listRedisSubscribers() {
  if (!redisConfigured()) return [];
  try {
    const result = await redis("SMEMBERS", SET_KEY);
    return Array.isArray(result) ? result.map(String) : [];
  } catch (e) {
    console.error("listRedisSubscribers", e);
    return [];
  }
}

async function isSubscribed(chatId) {
  const id = String(chatId);
  if (envChatIds().includes(id)) return true;
  if (!redisConfigured()) return false;
  try {
    const n = await redis("SISMEMBER", SET_KEY, id);
    return n === 1 || n === true;
  } catch {
    return false;
  }
}

/** Tất cả chat nhận broadcast (env ∪ Redis). */
async function getAllChatIds() {
  const set = new Set(envChatIds());
  for (const id of await listRedisSubscribers()) set.add(id);
  return [...set];
}

async function subscriberStats() {
  const redisIds = await listRedisSubscribers();
  const envIds = envChatIds();
  const all = await getAllChatIds();
  return {
    redisConfigured: redisConfigured(),
    redisCount: redisIds.length,
    envCount: envIds.length,
    total: all.length,
  };
}

module.exports = {
  SET_KEY,
  envChatIds,
  redisConfigured,
  addSubscriber,
  removeSubscriber,
  listRedisSubscribers,
  isSubscribed,
  getAllChatIds,
  subscriberStats,
};
