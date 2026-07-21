# Bật Redis (Upstash) cho bot Telegram

Bot cần Redis để **lưu mọi người đã /start** và gửi thông báo cho cả lớp.

## Cách 1 — Trong Vercel (khuyên dùng)

### Bước 1: Mở Storage

1. Vào [vercel.com/dashboard](https://vercel.com/dashboard)
2. Chọn project **sicictu** (hoặc tên project của bạn)
3. Tab **Storage** (trên menu project)

### Bước 2: Tạo Upstash Redis

1. Bấm **Create Database** / **Create** / **Browse Storage**
2. Chọn **Upstash Redis** (hoặc **KV** nếu hiện logo Upstash)
3. Đặt tên, ví dụ: `sic2026-subscribers`
4. Region: chọn gần (Singapore / Washington — tùy free tier)
5. **Create** / **Connect**

### Bước 3: Connect vào project

1. Khi hỏi **Connect to Project** → chọn project **sicictu**
2. Environments: tick **Production** (và Preview nếu muốn)
3. Confirm

Vercel sẽ **tự thêm** 2 biến môi trường:

| Biến | Ý nghĩa |
|------|---------|
| `UPSTASH_REDIS_REST_URL` | URL Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Token Redis |

### Bước 4: Redeploy (bắt buộc)

Env mới **chỉ có hiệu lực sau redeploy**:

1. Tab **Deployments**
2. Bản deploy mới nhất → **⋯** → **Redeploy**
3. Chờ **Ready**

### Bước 5: Kiểm tra

Mở:

```
https://sicictu.vercel.app/api/health
```

Cần thấy:

```json
"redis": true,
"subscribers": {
  "redisConfigured": true,
  ...
}
```

### Bước 6: Thử bot

Telegram → bot → gõ **`/start`**

- Không còn dòng *“Hệ thống lưu user chưa sẵn sàng”*
- Thấy **Đang bật thông báo** / **Đã đăng ký**

Health: `"chatCount"` tăng khi có người /start.

---

## Cách 2 — Tạo trên Upstash rồi dán vào Vercel

Nếu Vercel không hiện Storage Upstash:

1. Vào [console.upstash.com](https://console.upstash.com) → đăng ký free
2. **Create Database** → Redis → Free
3. Tab **REST API** → copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Vercel → Project → **Settings** → **Environment Variables**
5. Thêm 2 biến (Production)
6. **Redeploy**

---

## Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|------------|------------|
| Vẫn báo chưa bật Redis | Chưa Redeploy sau khi connect |
| `redis: false` trên health | Env chưa vào Production / sai tên biến |
| /start OK nhưng cron không gửi ai | Chưa ai /start lại sau khi bật Redis |
| Không thấy tab Storage | Dùng Cách 2 (console.upstash.com) |

**Tên biến phải đúng 100%** (copy y nguyên):

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

---

## Sau khi xong

| Việc | Kết quả |
|------|---------|
| Ai đó `/start` | Lưu vào Redis |
| Cron 8h / 16h / CN | Gửi **tất cả** id trong Redis |
| `/stop` | Xóa khỏi danh sách |

Không cần thêm từng Chat ID vào Vercel nữa (trừ admin seed `TELEGRAM_CHAT_IDS` nếu muốn).
