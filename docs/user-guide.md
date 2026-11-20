# BotTeam — hướng dẫn sử dụng

## 1. Cài đặt

**Cách nhanh (máy mới):** script tự cài Git, Node.js 22, Python 3.12 và uv nếu thiếu, rồi cài các gói của dự án.

- Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File install.ps1`
- macOS / Linux: `bash install.sh`

Máy chưa có gì, không cần clone trước: tải script về rồi chạy, nó tự clone vào `~/aiBotTeam`.

```bash
curl -fsSL https://raw.githubusercontent.com/jokerhung/aiBotTeam/master/install.sh -o install.sh && bash install.sh     # macOS / Linux
```
```powershell
iwr -useb https://raw.githubusercontent.com/jokerhung/aiBotTeam/master/install.ps1 -OutFile install.ps1; powershell -ExecutionPolicy Bypass -File install.ps1
```

Muốn cài luôn engine AI: thêm `--claude` / `-Claude` (Claude Code CLI) và/hoặc `--codex` / `-Codex` (Codex CLI) và/hoặc `--antigravity` / `-Antigravity` (Antigravity CLI, `agy`, dùng bộ cài chính thức của Google). Việc đăng nhập phải do bạn làm một lần, vì cần trình duyệt: chạy `claude` (nó mở trình duyệt để đăng nhập) hoặc `codex login`, rồi bấm **Check again** ở màn hình chào của BotTeam. Không dùng CLI thì thêm một endpoint tương thích OpenAI trong Cài đặt → Engines.

Tuỳ chọn: `--browser` / `-Browser` (tải thêm Chromium cho trình duyệt tích hợp của bot, khi máy không có Edge hoặc Chrome), `--skip-build` / `-SkipBuild`, `--dry-run` / `-DryRun` (chỉ in việc sẽ làm), `--dir` / `-Dir` (nơi clone). Script chạy lại được nhiều lần: cái gì có rồi thì bỏ qua. Trên Windows cần `winget` (có sẵn từ Windows 10 bản mới); trên Linux cần `sudo` nếu không chạy bằng root. Sau khi cài xong mà lệnh `uv`/`pnpm` chưa nhận, mở một cửa sổ terminal mới.

**Chuyển sang máy khác:** chạy `powershell -ExecutionPolicy Bypass -File zip-project.ps1` để đóng gói project (bỏ `.venv`, `node_modules` và các thư mục build như `.next`, `web/.next-export`, `server/botteam/webui`; thêm `-KeepBuild` nếu muốn giữ). Giải nén ở máy kia rồi chạy `install.ps1` / `install.sh` để cài lại và build.

**Cách thủ công:** cần Python 3.10+ và [uv](https://docs.astral.sh/uv/), Node 20+ và pnpm (chỉ khi tự build giao diện).

```bash
git clone <repo> && cd aiBotTeam
pnpm install
pnpm build:static            # build giao diện tĩnh một lần
uv run --project server botteam serve
```

Trên Windows có sẵn `start.bat`: giải phóng cổng rồi khởi động. `start.bat` chạy cả API lẫn web (`pnpm dev`), `start.bat server` chỉ chạy server API, `start.bat web` chỉ chạy web, `start.bat one` chạy một chương trình duy nhất (cần `pnpm build:static` trước).

Mở http://127.0.0.1:8899. Dữ liệu nằm ở `~/.botteam` (đổi bằng `BOTTEAM_DATA_DIR`).
Trình duyệt tích hợp (Computer) dùng Microsoft Edge hoặc Chrome có sẵn; nếu không có, chạy `playwright install chromium`.

## 2. Bot đầu tiên

1. Lần đầu mở, màn chào kiểm tra engine AI. Nếu chưa có, làm theo hướng dẫn cài và đăng nhập ngay trên màn đó, rồi bấm **Check again**.
2. Bấm **+** → **New bot**, đặt tên, chọn màu, bấm **Create**. Có thể chọn một bot mẫu (preset).
3. Bot tự chào và hỏi bạn muốn được giúp gì. Gõ vào ô chat để trò chuyện.
4. Mức duyệt của bot (Ask / Edits / Auto / Full) quyết định lúc nào bot phải xin phép trước khi chạy lệnh hoặc sửa file.

## 3. Cấu hình engine

- **Claude Code / Codex CLI:** cài CLI chính thức và đăng nhập (`claude login`, `codex login`). BotTeam tự dò.
- **Antigravity (`agy`):** cài Antigravity CLI (`install.ps1` / `install.sh` của antigravity.google, hoặc chạy script cài của BotTeam với `-Antigravity` / `--antigravity`) rồi chạy `agy` một lần để đăng nhập bằng tài khoản Google. BotTeam tự dò `agy` (trên PATH, hoặc `%LOCALAPPDATA%\agy\bin` / `~/.local/bin`), lấy danh sách model từ `agy models` và nói chuyện với nó qua giao thức ACP. Mức duyệt: Ask và Auto hỏi bạn qua thẻ duyệt, Edits cho sửa file không hỏi, Full không hỏi gì. Bot đọc được ảnh, dùng được công cụ đội và MCP riêng. Nếu `agy` nằm chỗ khác, nhập đường dẫn ở Settings → Engines. Việc đăng nhập vẫn do bạn làm một lần.
- **Endpoint tương thích OpenAI:** Settings → Engines → thêm địa chỉ và khoá. Khoá chỉ lưu trên máy này.
- Mỗi bot có model riêng; đổi ở nút model trên đầu cuộc trò chuyện.

## 4. Mở rộng

Danh sách Connected apps và trạng thái tài khoản được lấy từ Composio ở lần khởi tạo đầu tiên rồi lưu trong bảng `connected_apps_cache` của `messages.db`. Các lần mở lại, tải lại trang hoặc khởi động lại server đều đọc database, không tự gọi Composio và không hết hạn theo thời gian. Muốn lấy dữ liệu mới, bấm nút Refresh trong cửa sổ Connect apps. Riêng khi người dùng bắt đầu kết nối dịch vụ, server theo dõi tài khoản mới trong tối đa 5 phút; khi kết nối thành công sẽ tự refresh, lưu database và cập nhật giao diện, kể cả khi cửa sổ Connect apps đã đóng. Tài khoản cũ đang ACTIVE không được tính là lần kết nối mới thành công. Disconnect cập nhật tài khoản đã xoá ngay trong database. Dữ liệu được tách theo project key; thay key sẽ khởi tạo dữ liệu cho project mới.

- **Connected apps (qua Composio):** vào [Composio Dashboard → API Keys](https://dashboard.composio.dev/~/project/settings/api-keys), tạo khoá dự án (bắt đầu bằng `ak_`), dán vào hộp *Connected apps*. Chọn một app → đăng nhập ở trình duyệt của bạn. Mỗi app có thể nối nhiều tài khoản (đặt nhãn như `work`, `personal`); *Disconnect* chỉ ngắt tài khoản ở hàng đó. BotTeam không lưu token của Gmail/Slack/GitHub…; Composio giữ chúng. Có thể đặt khoá bằng biến môi trường `COMPOSIO_API_KEY`. Bật máy chủ MCP "Composio" cho bot ở phần Apps của bot; mọi công cụ vẫn hỏi trước theo mức duyệt. **Telegram** nằm đầu danh sách: mỗi bot Telegram (token từ BotFather) là một tài khoản riêng với nhãn riêng, ví dụ `shop`, `support`. App không có đăng nhập do Composio quản lý (như Xero) cần tạo *Auth Config* với OAuth app của bạn trong dashboard.
- **MCP server riêng:** thêm trong *Connect apps → Custom MCP servers*.
- **Input (Telegram bot, Zalo bot):** tab *Input* trong *Connect apps* cho phép một bot tự chạy khi có tin nhắn đến. Bấm *Connect* (hoặc *Add account*), đặt nhãn, dán token của bot (Telegram: lấy ở @BotFather và tắt privacy mode; Zalo: tạo ở tài khoản "Zalo Bot Manager"); BotTeam giữ token trên máy này và không hiện lại. Rồi bấm *Change* → *Let a bot use this account…* và điền mã chat bot phục vụ (gõ `/id` trong chat để xem mã), chat nhận kết quả, giới hạn lô và lời nhắc cho bot. Bot cần có *Working folder*, và engine phải đọc được ảnh. Cách chạy: nhân viên gửi PDF và ảnh vào chat, bot chỉ lưu vào `jobs/<mã lô>/` trong thư mục làm việc; bấm 🔍 Kiểm kê (hoặc gõ `/kiemke`) thì bot mới chạy đúng một lượt trên thư mục đó, và file bot ghi vào `out/` được gửi lại cho chat nhận kết quả. Zalo không nhận và không gửi được tệp: chỉ có chữ và ảnh. Mục Telegram trong *Connected apps* là việc khác: chỉ cho bot công cụ để gửi tin.
- **Zalo cá nhân (zca-js):** tab *Input* còn có mục *Zalo personal account*: bot trả lời người nhắn tin cho **tài khoản Zalo của chính bạn**, không cần tạo bot ở Zalo Bot Manager. Đặt tên cho tài khoản, bấm *Show QR code*, rồi mở Zalo trên điện thoại, quét mã QR và xác nhận đăng nhập. Phần này chạy bằng một dịch vụ Node.js riêng (`zalo-service/`, dùng thư viện [zca-js](https://github.com/RFS-ADRENO/zca-js), cổng `ZALO_PORT`, mặc định 8902, chỉ nghe `127.0.0.1`); `pnpm dev`, `start.bat` và `pnpm start:one` đã chạy sẵn nó, hoặc chạy riêng bằng `pnpm dev:zalo`. Trình duyệt gọi nó qua đường `/zalo-api` (proxy trong `web/next.config.mjs`; bản build tĩnh thì máy chủ Python chuyển tiếp). Phiên đăng nhập lưu ở `~/.botteam/zalo-service/` (quyền 0600). Lưu ý: zca-js là thư viện **không chính thức** mô phỏng Zalo Web, Zalo có thể khóa tài khoản dùng nó, và tin trả lời được gửi từ tài khoản của bạn. Chỉ nhận chữ và ảnh trong chat riêng (nhóm và tệp chưa hỗ trợ). Cấp quyền cho bot như các kênh khác (nên dùng chế độ *Answer every message* và bot ở mức Ask).
- **Quy trình nhận tin (`intake.md`):** mỗi bot có input có một file `intake.md` trong thư mục làm việc, nói bot nhận tin thế nào. Khi bạn cho bot dùng một tài khoản Telegram/Zalo mà thư mục chưa có file này, BotTeam tạo file mặc định (file sẵn có thì giữ nguyên): **chờ 30 giây không có ảnh hoặc tin mới thì tự lưu ảnh vào `jobs/<mã phiên>/` rồi chạy bot theo chỉ dẫn của nó**. Phần đầu file (giữa hai dòng `---`) là YAML: `trigger.quietSeconds` (0 = chỉ chạy khi bấm Kiểm kê), `save.path` (mẫu thư mục, ví dụ `{machine}/{date}/{phase}/` kèm `machines.md` để khớp tên máy trong chú thích như "Máy BH Flex M1 trước"), `ack` (tin xác nhận), `run.prompt` (lời nhắc khi chạy), `trigger.hintAfterSeconds` + `hint` (sau vài giây im lặng báo "Nếu không còn ảnh nào thì sau N giây sẽ tiến hành…", rồi cập nhật số giây còn lại sau mỗi chừng đó giây), `trigger.button: false` (bỏ nút Kiểm kê trong chat), `status: false` (không gửi tin trạng thái "📋 Lô …" vào chat), `ack` (báo tiến trình "Đang nhận: 3 ảnh"), `save.stage: true` + `run.start` (giữ ảnh tạm, báo "Đã nhận đủ 6 ảnh. Bắt đầu lưu file…" rồi mới lưu), không lưu lại file đã có sẵn trong folder (giống hệt từng byte; tin trả lời có thể dùng `{saved}`, `{skipped_note}`), `run.command` (chạy một script trong thư mục làm việc sau khi lưu ảnh, ví dụ tải PDF; thử lại sau mỗi `retryMinutes` phút trong `retryHours` giờ rồi báo lỗi cho chat nhận kết quả), biến `{dd}`, `{mm}`, `{area}` (cột "Khu vực" của `machines.md`), `run.agent: false` + `run.reply` (không gọi bot sau khi nhận, chỉ gửi lại một câu như "Đã nhận đủ 6 ảnh và lưu vào folder: BH FLEX M16-11-18\Truoc"; không tốn lượt AI và không cần file kết quả), `limits`. Sửa file có hiệu lực từ phiên kế tiếp, không cần khởi động lại; sửa ngay trong **Bot settings → Quy trình nhận tin (intake.md) → Sửa**, nơi có kiểm tra lỗi kèm số dòng trước khi lưu. File sai sau khi đã đúng thì bot vẫn chạy theo bản đúng gần nhất; file chưa từng đúng thì tin vẫn được gom nhưng chưa chạy. Ai được nhắn tin cho bot (`chats`) và chat nhận file kết quả vẫn đặt ở tab Input, không đặt trong file. Ví dụ đầy đủ trong `docs/examples/`. Bot tạo mà không nhập thư mục làm việc được cấp `workspaces/<mã bot>/` trong thư mục chạy BotTeam (đổi bằng `BOTTEAM_WORKSPACES`).
- **Computer:** nút màn hình trên đầu chat. Bot mở trang trong trình duyệt riêng của nó; bạn có thể *Take control* khi bot cần đăng nhập/CAPTCHA, rồi *Give it back*. Mặc định bot không mở được địa chỉ nội bộ (localhost, mạng riêng); bật trong bánh răng của panel nếu cần.
- **Trí nhớ và kỹ năng:** ghi chú giữ giữa các việc; skill là file `SKILL.md` bạn viết.
- **Xuất / nhập một bot:** trong dấu `…` của từng bot chọn **Export bot** để lưu bot thành một tệp Markdown/YAML (`*.bot.md`). Ở máy khác, menu **+** → **Import bot**. Tệp mang tên, chức danh, mô tả, chỉ dẫn, kỹ năng và danh sách kết nối bot dùng (kèm quyền đọc/ghi, danh sách công cụ cho phép, thời gian cache); không mang trí nhớ, lịch sử chat, khoá, model, mức duyệt, thư mục làm việc hay quyền kênh Zalo/Telegram. Khi nhập, bot mới ở mức Ask và không thuộc section nào, kỹ năng tắt, gửi ra ngoài luôn ở mức Ask; kết nối được tự gán lại nếu máy đó có kết nối cùng tên (Composio thì nhận ra theo loại), chưa có thì tạo rỗng và tắt. Trùng tên thì bot mới thành "Tên (2)".
- **Administrator (tạo và sửa bot bằng chat):** bấm icon chat (bong bóng) ở đầu cuộc trò chuyện, ngay bên trái icon màn hình (Computer), để mở khung chat với Administrator. Nhờ nó "tạo bot dịch Anh–Việt" hoặc "sửa bot X: đổi màu, thêm chỉ dẫn…"; nó nói lại đã tạo hoặc đổi gì. Nó chỉnh được tên, vai trò, mô tả, chỉ dẫn, màu, mức duyệt (Ask / Edits / Auto) và kết nối (chỉ đọc, chọn trong số đã kết nối ở Connect apps). Nó không xóa bot, không cấp quyền Full, không đặt thư mục làm việc và không chạm vào khóa: những việc đó làm trong phần cài đặt của từng bot. Bot mới luôn bắt đầu ở mức Ask. Administrator không nằm trong danh sách bot; nút model ở đầu khung cho bạn chọn engine và model để chat, như với bot thường (mặc định là engine mặc định của bạn).
- **Chia sẻ team:** menu **+** → Import team, hoặc chia sẻ một section thành một file Markdown (không kèm lịch sử chat hay khoá).

Nhận ảnh qua Telegram/Zalo chỉ tạo/cập nhật thông báo số lượng file trong main conversation. Khi người gửi bấm Kiểm kê hoặc gõ `/kiemke`, bot tạo conversation mới có tên là `job_id` (mã lô, trùng thư mục `jobs/<job_id>/`) và tự chuyển sang conversation đó. Main chỉ giữ thông báo ngắn, ví dụ “Đang kiểm đếm ở conversation b_1234”, kèm liên kết mở job; lời nhắc, nội dung trả lời và chi tiết công cụ nằm trong conversation của job. Nếu bot đang bận, conversation của job được tạo ngay với trạng thái chờ và được dùng tiếp khi đến lượt chạy.

## 5. Tự host

Khi job kiểm kê hoàn thành thành công, bot tự chuyển về main conversation để xem thông báo kết quả. Nếu có job tiếp theo trong hàng đợi, bot chuyển sang conversation của job đó khi bắt đầu chạy. Nếu bạn đã chọn một conversation khác trong lúc job chạy, lựa chọn đó được giữ nguyên.

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
