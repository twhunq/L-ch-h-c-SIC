# Lịch học SIC2026 – Samsung ICTU

App web + **bot Telegram** đồng bộ Google Sheet.

## Hai cách chạy bot

| Cách | Khi nào dùng | Máy tắt có nhận tin? |
|------|----------------|----------------------|
| **Vercel Cron (khuyên dùng)** | Deploy 1 lần, chạy cloud | **Có** |
| `start_bot.bat` local | Test nhanh trên PC | Không |

### Deploy Vercel (thông báo 8h & trước học 2 tiếng)

→ Xem chi tiết: **[DEPLOY.md](./DEPLOY.md)**

Tóm tắt:

1. Push repo lên GitHub → Import **Vercel**
2. Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS`, `CRON_SECRET`
3. Redeploy → gọi `/api/setup-webhook?secret=...`
4. Telegram: `/start` · test: `/api/cron?type=test&force=1&secret=...`

### Quy tắc lịch

- Sheet **cập nhật mỗi Chủ nhật**
- Có thể **đổi đến trước giờ học 2 tiếng**
- Bot **luôn đọc Sheet mới nhất** trước khi gửi tin

Cron (giờ VN):

- **Chủ nhật 08:00** – gửi lịch tuần tới  
- **08:00** các ngày có học – chào sáng  
- **16:00** – nhắc bản chốt (trước lớp 18:00 hai tiếng)

---

## App web local

```text
start.bat  →  http://127.0.0.1:8765/
```

## Bot local (không cần nếu đã Vercel)

```text
setup_bot.bat  →  điền token
start_bot.bat  →  chạy CMD 24/7 trên máy
```

## Cấu trúc chính

| Path | Mô tả |
|------|--------|
| `index.html` | Giao diện lịch học |
| `api/cron.js` | Vercel Cron gửi Telegram |
| `api/webhook.js` | Lệnh bot `/today` `/next`… |
| `api/setup-webhook.js` | Gắn webhook sau deploy |
| `lib/*` | Parse sheet + Telegram helpers |
| `telegram_bot.py` | Bot local (long-poll) |
| `parse_schedule.py` | Sync sheet → `schedule.json` |
| `DEPLOY.md` | Hướng dẫn Vercel |

## Nguồn

[Google Sheet – Training Schedule](https://docs.google.com/spreadsheets/d/1nnYhUeWdgkSE8wZvagctTT28VT7nyTUd9e3gDi8m-4s/edit#gid=1271431527)
