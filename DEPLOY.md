# Deploy lên Vercel – thông báo Telegram 24/7

Bot **không** chạy CMD trên máy bạn. Vercel **Cron** gọi API đúng giờ:

| Cron (UTC) | Giờ VN | Việc làm |
|------------|--------|----------|
| `0 1 * * *` → `/api/cron` | **08:00** | **Chủ nhật:** lịch tuần tới · **Ngày thường:** nhắc sáng nếu có học |
| `0 9 * * *` → `/api/cron` | **16:00** | Nhắc **bản chốt** trước giờ học 2 tiếng (lớp 18:00) |

### Quy tắc lịch (theo khóa học)

- Google Sheet **cập nhật mỗi Chủ nhật**
- Vẫn **có thể đổi** phòng/giờ/nội dung đến **trước giờ học 2 tiếng**
- Mỗi lần cron chạy → **fetch Sheet mới nhất** (không cache)
- Lúc preclass: nếu Sheet **không còn** buổi hôm nay → báo có thể đã hủy/dời

API tự nhận diện loại thông báo theo giờ Việt Nam.

> Gói **Hobby (free)** của Vercel cho cron **1 lần/ngày / job** — đủ cho 2 mốc trên.

---

## Bước 1 – Chuẩn bị token & Chat ID

1. Tạo bot với [@BotFather](https://t.me/BotFather) → copy `TELEGRAM_BOT_TOKEN`
2. Lấy **Chat ID**:
   - Cách A: nhắn [@userinfobot](https://t.me/userinfobot)
   - Cách B: sau khi deploy xong, mở bot → `/start` (webhook trả về Chat ID)

---

## Bước 2 – Đẩy code lên GitHub

Trong thư mục `lich-hoc-samsung`:

```bash
git init
git add .
git commit -m "Deploy lich hoc SIC2026 + Telegram cron"
```

Tạo repo trên GitHub, rồi:

```bash
git remote add origin https://github.com/USER/lich-hoc-sic2026.git
git branch -M main
git push -u origin main
```

---

## Bước 3 – Import project trên Vercel

1. Vào [vercel.com](https://vercel.com) → **Add New Project** → import repo
2. Framework Preset: **Other** (không cần build)
3. Bấm **Deploy**

---

## Bước 4 – Environment Variables

Vercel → Project → **Settings** → **Environment Variables** → thêm:

| Name | Value | Environments |
|------|--------|--------------|
| `TELEGRAM_BOT_TOKEN` | token từ BotFather | Production |
| `CRON_SECRET` | chuỗi ngẫu nhiên dài | Production |
| `TELEGRAM_CHAT_IDS` | (tùy chọn) chat id admin | Production |
| `PUBLIC_BASE_URL` | `https://sicictu.vercel.app` | Production |

**Không cần** `TELEGRAM_WEBHOOK_SECRET` (dễ làm /start im lặng nếu lệch).

Sau khi lưu → **Deployments** → ⋯ → **Redeploy**.

---

## Bước 4b – Upstash Redis (bắt buộc nếu muốn nhiều user)

Để **mọi người /start đều nhận thông báo**:

1. Vercel project → tab **Storage** (hoặc Marketplace)
2. **Create Database** → **Upstash Redis** → Connect vào project
3. Vercel tự thêm:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. **Redeploy**

Cách hoạt động:

- User gõ `/start` → chat id được `SADD` vào Redis  
- Cron gửi tin cho **tất cả** id trong Redis (+ `TELEGRAM_CHAT_IDS`)  
- User gõ `/stop` → gỡ khỏi danh sách  

---

## Bước 5 – Gắn webhook (để bot trả lời /start)

Domain của bạn:

```
https://sicictu.vercel.app/api/setup-webhook?secret=CRON_SECRET_CUA_BAN
```

Cần `"ok": true`, có `bot` và `webhook`: `https://sicictu.vercel.app/api/webhook`.

Kiểm tra webhook:

```
https://sicictu.vercel.app/api/setup-webhook?secret=CRON_SECRET&action=info
```

`url` phải trỏ đúng `/api/webhook`, `pending_update_count` ổn.

Health:

```
https://sicictu.vercel.app/api/health
```

- `hasToken: true`
- `redis: true` (sau khi gắn Upstash)
- `chatCount` tăng sau mỗi /start

---

## Bước 6 – Mọi người dùng bot

1. Share link bot: `https://t.me/TEN_BOT` (thấy trong JSON setup-webhook)
2. Mỗi người gõ **`/start`** → đăng ký
3. Gõ **`/stop`** nếu không muốn nhận nữa

### Test

Telegram: `/test` (chỉ gửi cho chính bạn)

Broadcast thử (gửi tất cả subscriber):

```
https://sicictu.vercel.app/api/cron?type=test&force=1&secret=CRON_SECRET
```

---

## Bước 7 – Web app

```
https://sicictu.vercel.app/
```

---

## Lưu ý quan trọng

1. **Máy tắt vẫn nhận tin** – miễn Vercel project còn active.
2. **Hobby cron** chỉ chạy trên **Production** deployment.
3. Nếu đổi giờ học khác `18h00`, mốc preclass 16:00 có thể lệch — báo để chỉnh `vercel.json`.
4. Nhiều người nhận: `TELEGRAM_CHAT_IDS=111,222,333`
5. Local `start_bot.bat` **không cần** nữa khi đã deploy (tránh gửi trùng). Có thể tắt CMD local.

---

## Troubleshooting

| Vấn đề | Cách xử lý |
|--------|------------|
| Cron không chạy | Vercel → Project → Settings → Cron Jobs; cần gói Hobby+ và Production |
| 401 Unauthorized | Sai `CRON_SECRET` hoặc thiếu query `?secret=` |
| Không nhận tin | Sai `TELEGRAM_CHAT_IDS`; bot chưa được `/start` lần nào |
| Sheet lỗi | Sheet phải public view (Anyone with the link) |
| Lệnh bot không trả lời | Gọi lại `/api/setup-webhook?secret=...` |

---

## CLI nhanh (nếu đã cài Vercel CLI)

```bash
npm i -g vercel
cd lich-hoc-samsung
vercel login
vercel link
vercel env add TELEGRAM_BOT_TOKEN
vercel env add TELEGRAM_CHAT_IDS
vercel env add CRON_SECRET
vercel --prod
```
