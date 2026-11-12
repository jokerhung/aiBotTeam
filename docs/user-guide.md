# BotTeam — hướng dẫn sử dụng

## 1. Cài đặt

Cần: Python 3.12+ và [uv](https://docs.astral.sh/uv/), Node 20+ và pnpm (chỉ khi tự build giao diện).

```bash
git clone <repo> && cd aiBotTeam
pnpm install
pnpm build:static            # build giao diện tĩnh một lần
uv run --project server botteam serve
```

Mở http://127.0.0.1:8899. Dữ liệu nằm ở `~/.botteam` (đổi bằng `BOTTEAM_DATA_DIR`).
Trình duyệt tích hợp (Computer) dùng Microsoft Edge hoặc Chrome có sẵn; nếu không có, chạy `playwright install chromium`.

## 2. Bot đầu tiên

1. Lần đầu mở, màn chào kiểm tra engine AI. Nếu chưa có, làm theo hướng dẫn cài và đăng nhập ngay trên màn đó, rồi bấm **Check again**.
2. Bấm **+** → **New bot**, đặt tên, chọn màu, bấm **Create**. Có thể chọn một bot mẫu (preset).
3. Bot tự chào và hỏi bạn muốn được giúp gì. Gõ vào ô chat để trò chuyện.
4. Mức duyệt của bot (Ask / Edits / Auto / Full) quyết định lúc nào bot phải xin phép trước khi chạy lệnh hoặc sửa file.

## 3. Cấu hình engine

- **Claude Code / Codex CLI:** cài CLI chính thức và đăng nhập (`claude login`, `codex login`). BotTeam tự dò.
- **Endpoint tương thích OpenAI:** Settings → Engines → thêm địa chỉ và khoá. Khoá chỉ lưu trên máy này.
- Mỗi bot có model riêng; đổi ở nút model trên đầu cuộc trò chuyện.

## 4. Mở rộng

- **Connected apps (qua Composio):** vào [Composio Dashboard → API Keys](https://dashboard.composio.dev/~/project/settings/api-keys), tạo khoá dự án (bắt đầu bằng `ak_`), dán vào hộp *Connected apps*. Chọn một app → đăng nhập ở trình duyệt của bạn. Mỗi app có thể nối nhiều tài khoản (đặt nhãn như `work`, `personal`); *Disconnect* chỉ ngắt tài khoản ở hàng đó. BotTeam không lưu token của Gmail/Slack/GitHub…; Composio giữ chúng. Có thể đặt khoá bằng biến môi trường `COMPOSIO_API_KEY`. Bật máy chủ MCP "Composio" cho bot ở phần Apps của bot; mọi công cụ vẫn hỏi trước theo mức duyệt. **Telegram** nằm đầu danh sách: mỗi bot Telegram (token từ BotFather) là một tài khoản riêng với nhãn riêng, ví dụ `shop`, `support`. App không có đăng nhập do Composio quản lý (như Xero) cần tạo *Auth Config* với OAuth app của bạn trong dashboard.
- **MCP server riêng:** thêm trong *Connect apps → Custom MCP servers*.
- **Input (Telegram bot, Zalo bot):** tab *Input* trong *Connect apps* cho phép một bot tự chạy khi có tin nhắn đến. Bấm *Connect* (hoặc *Add account*), đặt nhãn, dán token của bot (Telegram: lấy ở @BotFather và tắt privacy mode; Zalo: tạo ở tài khoản "Zalo Bot Manager"); BotTeam giữ token trên máy này và không hiện lại. Rồi bấm *Change* → *Let a bot use this account…* và điền mã chat bot phục vụ (gõ `/id` trong chat để xem mã), chat nhận kết quả, giới hạn lô và lời nhắc cho bot. Bot cần có *Working folder*, và engine phải đọc được ảnh. Cách chạy: nhân viên gửi PDF và ảnh vào chat, bot chỉ lưu vào `jobs/<mã lô>/` trong thư mục làm việc; bấm 🔍 Kiểm kê (hoặc gõ `/kiemke`) thì bot mới chạy đúng một lượt trên thư mục đó, và file bot ghi vào `out/` được gửi lại cho chat nhận kết quả. Zalo không nhận và không gửi được tệp: chỉ có chữ và ảnh. Mục Telegram trong *Connected apps* là việc khác: chỉ cho bot công cụ để gửi tin.
- **Computer:** nút màn hình trên đầu chat. Bot mở trang trong trình duyệt riêng của nó; bạn có thể *Take control* khi bot cần đăng nhập/CAPTCHA, rồi *Give it back*. Mặc định bot không mở được địa chỉ nội bộ (localhost, mạng riêng); bật trong bánh răng của panel nếu cần.
- **Trí nhớ và kỹ năng:** ghi chú giữ giữa các việc; skill là file `SKILL.md` bạn viết.
- **Chia sẻ team:** menu **+** → Import team, hoặc chia sẻ một section thành một file Markdown (không kèm lịch sử chat hay khoá).

Nhận ảnh qua Telegram/Zalo chỉ tạo/cập nhật thông báo số lượng file trong main conversation. Khi người gửi bấm Kiểm kê hoặc gõ `/kiemke`, bot tạo conversation mới có tên là `job_id` (mã lô, trùng thư mục `jobs/<job_id>/`) và tự chuyển sang conversation đó. Main chỉ giữ thông báo ngắn, ví dụ “Đang kiểm đếm ở conversation b_1234”, kèm liên kết mở job; lời nhắc, nội dung trả lời và chi tiết công cụ nằm trong conversation của job. Nếu bot đang bận, conversation của job được tạo ngay với trạng thái chờ và được dùng tiếp khi đến lượt chạy.

## 5. Tự host

Để mở web qua LAN/Tailscale khi chạy `pnpm dev`, đặt `WEB_HOST=0.0.0.0` trong `.env`, giữ `SERVER_HOST=127.0.0.1`, rồi khởi động lại cả web và server. Truy cập `http://<IP LAN hoặc IP Tailscale>:5299`; API đi qua proxy của web nên chỉ cần cổng web. Localhost và IP LAN/Tailscale vào thẳng, không cần ghép nối. Truy cập bằng tên miền (kể cả tên MagicDNS của Tailscale) vẫn cần mã ghép nối trong console server. Next tự cho phép các IP hiện có của máy dùng tài nguyên dev/HMR; nếu dùng tên DNS khác, thêm hostname vào `WEB_ALLOWED_HOSTS` (phân cách bằng dấu phẩy).

```bash
docker compose up -d                       # một image, volume cho dữ liệu; lần đầu build ~5 phút
BOTTEAM_IMAGE=ghcr.io/<owner>/<repo>:latest docker compose up -d   # kéo image dựng sẵn (workflow .github/workflows/image.yml): sẵn sàng trong vài giây
botteam serve --host 0.0.0.0 --port 8899   # nghe ngoài máy này
```

Khi mở truy cập mạng, BotTeam yêu cầu ghép cặp với truy cập bằng tên miền hoặc IP công cộng: console in một mã dùng một lần (10 phút); nhập mã trên trình duyệt để đăng nhập. Localhost, IP LAN và IP Tailscale không cần ghép cặp. Proxy web ghi đè `X-Forwarded-Host` bằng host thực của trình duyệt; backend chỉ tin header này từ proxy loopback và chạy với `proxy_headers=False` (hoặc `--no-proxy-headers` nếu gọi uvicorn trực tiếp). Nên đặt truy cập tên miền sau HTTPS (reverse proxy).

- Sao lưu: Settings → Backup tải một file zip; khôi phục: dừng server rồi `botteam restore <file>`.
- Điều khiển không màn hình: `botteam run "<bot>" "<việc>" --json`, `botteam team apply team.yaml`; mã thoát 0 ok, 1 lỗi, 2 sai cú pháp, 3 quá giờ, 4 cần người.
- `botteam mcp` chạy MCP server của app cho Claude Desktop/Cursor (không có công cụ duyệt, xoá, cấu hình hay bí mật).

## 6. Xử lý sự cố

- **Windows báo `Accept failed on a socket` / `WinError 87`:** dừng phiên dev cũ bằng `Ctrl+C`, rồi chạy lại `pnpm dev`. Trên Windows, launcher dùng `botteam.dev` để theo dõi file Python và khởi động lại server với socket mới; vẫn giữ Proactor để Codex/Claude và các tiến trình con chạy được. Không chạy trực tiếp Uvicorn với tổ hợp `--reload --loop botteam.loop:loop_factory` trên Windows vì socket chia sẻ của reloader có thể lỗi IOCP.

- Không có engine: banner đỏ trên đầu; làm theo bước 3.
- Trình duyệt Computer báo không khởi động: cài Edge/Chrome hoặc `playwright install chromium`.
- Quên mã ghép cặp: khởi động lại server để nhận mã mới.
