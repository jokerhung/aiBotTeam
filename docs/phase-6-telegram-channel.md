# Phase 6 — Kênh Telegram, Zalo Bot và bot kiểm kê máy bán hàng

**Mục tiêu:** một bot của BotTeam nhận PDF và ảnh từ Telegram hoặc Zalo, lưu vào một thư mục cho mỗi lô, và chỉ khi nhân viên bấm **Kiểm kê** mới gọi Claude CLI hoặc Codex CLI kèm thư mục đó. Khi xong, bỏ được phần Telegram và phần gọi AI trong `D:\hungnm\outsource\duchien\maybanhang_03`.

**Tham chiếu:**

- Bot cũ: `maybanhang_03\src\handlers.py` (luồng Telegram), `runner.py` (gọi CLI), `storage.py` (lô và thư mục), `pdf_parser.py`, `report.py`, `workspace\AGENTS.md`, `workspace\skill_src\SKILL.md`.
- BotTeam: `server/botteam/composio.py` và các route `/api/apps`, `/api/composio` trong `main.py` (Connected apps qua Composio, từ commit `8fa1b1f` và `c701aaf`), `mcp_servers.py` (cách một bot được cấp quyền dùng một kết nối), `webhooks.py` (mẫu dịch vụ nhận sự kiện ngoài), `routines.py` (mẫu dịch vụ nền có `run_finished`), `turns.py` (`_start_turn`, `_after_turn`), `config.py` (bí mật chỉ ghi), `web/components/ConnectedApps.tsx`, phần Connected apps trong `web/components/BotPanel.tsx`.

**Khác bản gốc (có chủ ý):** OpenMausBot không có kênh Telegram; trong mã nguồn gốc chỉ có vài chỗ nhắc tên. Đây là tính năng thêm của BotTeam, nên không có màn hình gốc để chép. Giao diện dùng lại thẻ Connected apps và phần cấp quyền theo bot hiện có.

## 0. Hiện trạng trong BotTeam và phần còn thiếu

Đã có trong code (kiểm tra ngày 2026-11-12):

- Connected apps đi qua **Composio** bằng khoá dự án của người dùng (`composio.py`). Telegram đứng đầu danh sách; mỗi token BotFather là một tài khoản có nhãn, tối đa 5 tài khoản, có **Add account** và **Disconnect** theo từng dòng (`ConnectedApps.tsx`, `test_composio.py`).
- Token Telegram do Composio giữ. BotTeam chỉ lưu khoá dự án Composio, mã người dùng và mã Session; server **không có** token Telegram.
- Bot dùng app qua một MCP server tên "Composio", bật trong phần "Apps and servers" của bot kèm mức Read/Write và hỏi trước khi gửi (`BotPanel.tsx`). Quyền áp cho cả server Composio: mọi app và mọi tài khoản. Chưa có quyền theo từng app hay từng tài khoản, chưa có dòng "Used by … Change".
- Test Telegram chạy với Composio giả; chưa có bằng chứng đã thử với Composio và Telegram thật.

Telegram qua Composio làm được gì (theo trang toolkit Telegram của Composio, 18 công cụ, 0 trigger):

| Việc | Qua Composio |
|---|---|
| Bot gửi tin, ảnh, file PDF | Có (`TELEGRAM_SEND_MESSAGE`, `TELEGRAM_SEND_PHOTO`, `TELEGRAM_SEND_DOCUMENT`) |
| Sửa tin, trả lời nút bấm | Có (`TELEGRAM_EDIT_MESSAGE`, `TELEGRAM_ANSWER_CALLBACK_QUERY`) |
| Tự chạy khi có tin đến | **Không**: toolkit không có trigger nào, và BotTeam cũng chưa có code app event |
| Đọc tin đến | Chỉ khi bot chủ động gọi `TELEGRAM_GET_UPDATES` trong một lượt |
| Tải ảnh, PDF người dùng gửi | **Không**: không có công cụ lấy file |

Kết luận: kết nối Composio hiện có đủ cho bot **gửi ra**, không đủ để **nhận tin và lấy file**. Bot kiểm kê cần đúng hai việc này, nên phase này thêm một lớp nhận tin riêng ("kênh") mà server tự giữ token.

Ràng buộc từ Telegram: một token chỉ có một nơi gọi `getUpdates`. Khi một tài khoản đã bật kênh nhận tin, bot không được gọi `TELEGRAM_GET_UPDATES` (và `TELEGRAM_GET_CHAT_HISTORY`, vốn cũng đọc update) qua Composio trên cùng token, nếu không hai bên giành tin của nhau. Hướng dẫn và lời nhắc hệ thống của bot phải ghi rõ điều này.

## 0.1 Mô hình kênh nhận tin: nhiều tài khoản, cấp cho từng bot

Kênh nhận tin nằm trong cùng hộp **Connected apps**, ở tab thứ ba tên **Input** (xem mục 4), gồm **Telegram bot** và **Zalo bot**, mỗi kênh có nhiều tài khoản (mỗi tài khoản là một token), theo cùng cách hiển thị mà Connected apps đang dùng và theo bản gốc (`apps/docs/content/docs/connected-apps/multiple-accounts.mdx`):

| Tầng | Ở đâu | Chứa gì |
|---|---|---|
| Tài khoản | Connect apps → tab **Input** → Telegram bot / Zalo bot → **Connect** / **Add account** | Nhãn do người dùng đặt (ví dụ `duchien`, `khach_b`), token (server giữ, chỉ ghi), trạng thái nhận tin. Tối đa 5 tài khoản, như Connected apps. |
| Cấp quyền | Dòng **Used by … · Change** của tài khoản, và cài đặt của từng bot | Bot nào dùng tài khoản nào, phục vụ những chat nào, chat admin nào nhận kết quả, giới hạn của lô. |

Telegram vì thế có mặt ở hai nơi với hai vai trò: mục Telegram của Composio (bot gọi công cụ để gửi) và kênh Telegram (nhận tin, gom lô, trả kết quả). Cùng một token có thể khai ở cả hai. Kênh tự gửi kết quả bằng token của nó, nên bot kiểm kê không cần bật Composio.

Quy tắc theo bản gốc:

- Mỗi tài khoản mới đều phải đặt nhãn, kể cả tài khoản đầu tiên; nhãn không trùng nhau trong cùng app.
- Mỗi tài khoản hiện thành một dòng riêng với nhãn và trạng thái (`active` / lỗi). **Disconnect** chỉ gỡ đúng tài khoản đó, các tài khoản khác vẫn chạy.
- Thêm tài khoản không bao giờ ghi đè tài khoản đang có. Dán lại một token đã kết nối thì bị từ chối.

Định tuyến:

- Một tài khoản dùng được cho nhiều bot. Tin đến được định tuyến theo cặp **(tài khoản, chat)**: mỗi cặp thuộc về nhiều nhất một bot. Lưu cấu hình sẽ bị từ chối nếu cặp đó đã thuộc bot khác.
- Một bot có thể được cấp nhiều tài khoản.
- Chat chưa được cấp cho bot nào chỉ được trả lời lệnh `/id` (để lấy mã chat mà điền vào).
- Gỡ một tài khoản thì các bot mất quyền trên tài khoản đó, giống cách xoá một MCP server đang gỡ nó khỏi các bot.

Hai điểm khác bản gốc (có chủ ý):

- **Cấp quyền chọn tài khoản.** Ở bản gốc, quyền của bot áp cho cả dịch vụ và bot tự chọn tài khoản khi gọi công cụ. Với Telegram thì tin đến trên một tài khoản cụ thể, nên quyền phải gắn với từng tài khoản.
- **Loại kết nối mới.** Connected apps hiện nay đều đi qua Composio và một MCP server (bot gọi ra ngoài). Kênh nhận tin vào và tự bắt đầu lượt, token do server giữ, nên nó không đi qua `composio.py`, `mcp_servers` hay `mcp_proxy`.

**Zalo Bot** là kênh thứ hai (Composio không có Zalo Bot trong danh sách dự phòng của BotTeam; chưa kiểm tra catalog đầy đủ), dùng chung toàn bộ mô hình trên: nhiều tài khoản có nhãn, cấp theo bot, định tuyến theo (tài khoản, chat). Phần chung nằm ở `server/botteam/channels/` (`base.py`: gom lô, hàng đợi, trả kết quả; `telegram.py` và `zalo.py`: chỉ lo nhận và gửi). Mỗi bộ nối khai báo khả năng của nó (`files_in`, `files_out`, `buttons`, `edit`, `groups`) để phần chung chọn cách hiển thị. Zalo Bot thiếu nhiều khả năng so với Telegram; xem mục 3.8. Ở các mục 1–3.7, chỗ nào ghi "Telegram" mà không nói riêng thì áp cho cả hai.

Phạm vi: phase này chỉ thêm lớp kênh nhận tin. Phần Connected apps qua Composio (kể cả nhiều tài khoản) đã có và không sửa; hộp thoại chỉ được chia thành ba tab và phase này làm cho tab Input hoạt động.

## 0.2 Bản gốc nối Telegram qua Composio như thế nào, và vì sao không đi đường đó

Bản gốc không có dòng code nào riêng cho Telegram. Telegram chỉ là một toolkit của Composio, đi qua hai cơ chế chung cho mọi app:

| Chiều | Cơ chế ở bản gốc | Mã nguồn |
|---|---|---|
| Bot gửi ra | Bot gọi công cụ Composio (ví dụ `TELEGRAM_SEND_MESSAGE`), theo quyền công cụ của từng bot và cài đặt "Sending on your behalf" | `docs/composio.md` mục Per-bot tool grants; `shared/today-outcomes.test.ts` |
| Tin đến | Automation loại **app event**: trigger của Composio → dịch vụ kết nối của OpenMausBot xếp hàng → server kéo về (`GET /v1/events`) → mỗi sự kiện thành một lần chạy routine | `server/app-triggers.ts`, `server/app-events.ts`, `shared/app-triggers.ts`, `cloudflare/composio-broker/` |

Lý do không dùng đường này cho bot kiểm kê:

- **Không gom lô theo ý người dùng.** Sự kiện đến là chạy ngay (tối đa 20 sự kiện một lần chạy, 3 lần chạy chờ cho mỗi automation). Không có bước "nhận đủ PDF và ảnh rồi mới bấm Kiểm kê".
- **Sự kiện chỉ là JSON.** Ảnh và PDF không được tải về đĩa; bot phải tự gọi công cụ để lấy từng file trong lượt AI.
- **Không dùng được với khoá Composio riêng.** App event chỉ chạy qua dịch vụ kết nối của OpenMausBot; server dùng khoá Composio riêng thì không theo dõi được app (`docs/composio.md` mục App events). BotTeam đang dùng đúng kiểu khoá riêng này, chưa có code app event, và phần cloud nằm ngoài phạm vi từ đầu.
- **Toolkit Telegram của Composio không có trigger và không có công cụ tải file** (xem mục 0), nên dù có làm app event thì Telegram vẫn không nhận được tin và file.
- **Không có Zalo Bot** trong đường này.

Những gì lấy lại từ bản gốc cho phase này:

- [ ] Khung lời nhắc của `server/app-events.ts`: chỉ dẫn do người dùng cấu hình đặt riêng, dữ liệu từ app đặt trong khối "dữ liệu không tin cậy", ký tự giả mạo khối bị vô hiệu hoá.
- [ ] Nhật ký từng sự kiện với kết quả `started | joined | filtered | duplicate | skipped | rejected` (kiểu `AppEventAttempt`), thay cho nhật ký lô chỉ có trạng thái.
- [ ] Con trỏ nhận tin chỉ tiến sau khi sự kiện đã được lưu; sự kiện gửi lại được nhận ra bằng mã của nó.
- [ ] Giới hạn số lô chờ cho mỗi bot (bản gốc: 3 lần chạy chờ cho mỗi automation).
- [ ] Bot chỉ nhận tin từ app mà nó được cấp (`botMayWatchApp`), đúng với mô hình cấp quyền ở mục 0.
- [ ] Kết nối hỏng hiện là **Needs you** kèm **Reconnect**, thay cho chỉ ghi `lastError`.
- [ ] Gửi ra ngoài theo cài đặt "Sending on your behalf" của bot, nếu sau này bot được tự gửi tin Telegram/Zalo bằng công cụ.

## 1. Luồng tổng quát

```
Nhóm Telegram ──getUpdates──▶ TelegramService (trong server BotTeam)
                                   │ 1. lọc chat được phép
                                   │ 2. tải PDF/ảnh vào thư mục lô, KHÔNG gọi AI
                                   │ 3. nhân viên bấm "Kiểm kê"
                                   ▼
                    turns._start_turn(bot, thread mới, lời nhắc + đường dẫn lô)
                                   │  engine chạy trong thư mục làm việc của bot
                                   ▼
                    Claude CLI / Codex CLI đọc ảnh, chạy script, ghi kết quả vào out/
                                   │
                    _after_turn ──▶ TelegramService gửi tin ngắn cho nhân viên,
                                    gửi file trong out/ cho chat admin
```

Ba nguyên tắc:

1. **Lưu trước, gọi AI sau.** Mỗi tin nhắn Telegram không phải một lượt AI. Một lô chỉ tốn một lượt.
2. **Thư mục làm việc của bot cố định, lô là thư mục con.** Bot chạy ở `<cwd>` (ví dụ `maybanhang_03\workspace`), lô nằm ở `<cwd>\jobs\<id>\`. Nhờ vậy skill và `AGENTS.md` ở `<cwd>` luôn được nạp, và engine không phải xin quyền đọc ngoài thư mục làm việc.
3. **Nội dung từ Telegram là dữ liệu ngoài.** Lượt chạy mang gốc `outside` như webhook, không mang thẩm quyền của người dùng app.

## 2. Bố cục thư mục lô

```
<cwd>\jobs\<id>\
    batch.json     chat, người gửi, thời điểm, chú thích từng file (do server ghi)
    images\        001_<tên gốc>.jpg, 002_...   (ảnh và file ảnh)
    files\         phieu.pdf và tài liệu khác
    out\           file bot tạo ra để gửi lại Telegram
```

- [ ] Tên file qua `safe_name` như bot cũ; đánh số theo thứ tự nhận.
- [ ] `images\` giữ đúng tên thư mục bot cũ dùng, để `AGENTS.md` và skill hiện có gần như không phải sửa.
- [ ] Dọn lô cũ theo số ngày giữ (mặc định 60), lô mở quá 24 giờ thì đóng.

## 3. Backend: `server/botteam/channels/`

### 3.1 Dữ liệu

- [ ] Danh sách kênh cố định trong `channels/__init__.py`: `telegram` (token BotFather) và `zalo` (token từ Zalo Bot Manager). Không đụng tới catalog Composio.
- [ ] Bảng `channel_accounts`: `id`, `app` (`telegram | zalo`), `label` (duy nhất trong một app), `remoteId` và `username` (từ `getMe`; `remoteId` duy nhất trong một app để chặn kết nối trùng token), `enabled`, `cursor` (Telegram: offset của update cuối; Zalo: các `message_id` gần đây), `lastAt`, `lastError`. Tối đa 5 hàng mỗi app.
- [ ] Bảng `channel_grants` (cấp quyền theo cặp tài khoản và bot): `accountId`, `botId`, `chats`, `adminChats`, `maxPhotos`, `timeoutSec`, `remindAt`, `retentionDays`, `prompt` (lời nhắc mẫu). Ràng buộc: trong một tài khoản, một chat chỉ nằm trong `chats` của một bot.
- [ ] Bảng `channel_batches`: `id`, `accountId`, `botId`, `chatId`, `userId`, `status` (`collecting | queued | running | done | failed | cancelled | expired`), `dir`, `threadId`, `statusMessageId`, `files` (JSON), `error`, `createdAt`.
- [ ] Token lưu bằng `config.set_secret("channel:<app>:<accountId>", ...)`: chỉ ghi, UI chỉ thấy nhãn và trạng thái. Token Zalo nằm trong đường dẫn URL khi gọi API, nên không ghi URL đó vào log.
- [ ] `adminChats` là danh sách cặp (tài khoản, chat), có thể thuộc kênh khác với kênh nhận lô.
- [ ] Xoá bot thì xoá các hàng cấp quyền của nó; gỡ một tài khoản thì xoá token, các hàng cấp quyền của tài khoản đó và dừng nhận tin của riêng nó.
- [ ] Kiểu `WireChannelAccount`, `WireChannelGrant`, `WireChannelBatch` trong `wire.py`; frame `channel.account`, `channel.account.deleted`, `channel.grant`, `channel.batch`.

### 3.2 Nhận tin

- [ ] Long polling `getUpdates` bằng `httpx` (đã có trong `pyproject.toml`), một task asyncio cho mỗi tài khoản đang bật; tài khoản này lỗi không làm dừng tài khoản khác. Không cần URL công khai hay tunnel.
- [ ] Lưu `offset` theo từng tài khoản sau mỗi update để khởi động lại không xử lý trùng và không bỏ sót.
- [ ] Định tuyến: tra cặp (tài khoản nhận tin, `chat.id`) trong `channel_grants` để ra bot đích. Chat không thuộc bot nào chỉ được trả lời lệnh `/id`.
- [ ] Trả lời và gửi file luôn đi bằng đúng tài khoản đã nhận lô đó.
- [ ] Lỗi mạng: lùi dần rồi thử lại; lỗi 401 (token sai) hoặc 409 (token đang được tiến trình khác dùng) thì tắt tài khoản đó, ghi `lastError`, báo trong hộp thông báo của app và trên dòng tài khoản.
- [ ] Khởi động và dừng trong `lifespan` của `main.py`, cạnh `routines.start()`.

### 3.3 Gom lô

- [ ] Lô đang mở tính theo cặp (chat, người gửi), như `Store.active` của bot cũ.
- [ ] Ảnh (`photo`) và file ảnh (`document` có mime ảnh) vào `images\`; file khác vào `files\`. Bỏ qua file trên 20 MB (giới hạn tải của Telegram cho bot) và báo cho người gửi.
- [ ] Ảnh gửi dạng nén: vẫn nhận, kèm một dòng nhắc nên gửi dạng File.
- [ ] Một tin trạng thái cho mỗi lô, sửa tại chỗ khi có file mới (gộp cập nhật trong khoảng 2 giây để không chạm giới hạn của Telegram), có nút **Kiểm kê** và **Huỷ**.
- [ ] Bàn phím cố định sau `/start`: `📄 Gửi PDF`, `📷 Gửi ảnh`, `🔍 Kiểm kê`. Lệnh `/id`, `/help`, `/tomtat`.
- [ ] Quy tắc riêng của kiểm kê (giai đoạn 3): PDF mới khi lô cũ chưa kiểm kê thì hỏi bằng nút; reply vào tin PDF để chỉ rõ ảnh thuộc lô nào.

### 3.4 Chạy lô

- [ ] Kiểm tra trước khi chạy: có ít nhất một ảnh; bot có thư mục làm việc; engine đọc được ảnh (`capabilities.images`).
- [ ] Mỗi lô là một thread (task) mới của bot, tiêu đề `Kiểm kê <chat> <giờ>`, để ngữ cảnh các lô không lẫn nhau và xem lại được trong app.
- [ ] Lời nhắc do server viết từ mẫu trong phần cấp quyền của bot, bọc bằng `envelope(...)` như webhook, có đường dẫn tương đối `jobs/<id>/`.
- [ ] Mở rộng `_start_turn`: thêm tham số `extra_images` (đường dẫn tuyệt đối trong thư mục lô, tối đa `maxPhotos`) nối vào `image_attachments`. Driver Codex cần danh sách này để truyền `-i`; driver Claude tự đọc file theo đường dẫn.
- [ ] `ThreadRun` thêm `channel_batch_id`; `_after_turn` gọi `channels.turn_done(...)` theo đúng cách `routines.run_finished` đang được gọi.
- [ ] Hàng đợi theo bot: mỗi lúc chạy một lô (tương đương `MAX_PARALLEL_JOBS=1`), lô sau ở trạng thái `queued` và tin trạng thái ghi rõ đang chờ.
- [ ] Quá `timeoutSec` (mặc định 900) thì `turns.interrupt` và coi là thất bại.
- [ ] Sau khi server khởi động lại: lô `running` chuyển thành `failed` kèm nút **Thử lại**; không tự chạy lại.

### 3.5 Trả kết quả

- [ ] Thành công khi lượt kết thúc bình thường **và** `out\` có ít nhất một file. Lượt xong mà `out\` rỗng là thất bại.
- [ ] Người gửi nhận tin ngắn "Đã kiểm kê xong máy …".
- [ ] File trong `out\` và câu trả lời cuối của bot gửi tới `adminChats` bằng `sendDocument`. Nếu `adminChats` trống thì gửi đầy đủ cho chat vừa kiểm kê, để không mất kết quả.
- [ ] Thất bại: người gửi nhận tin lỗi ngắn có nút **Thử lại**; admin nhận chi tiết; app có thông báo `channel_failed`.
- [ ] Nhắc lô chưa bấm Kiểm kê vào giờ `remindAt` (mặc định 18:30).

### 3.6 Mức duyệt khi không có người ngồi ở app

Đây là điểm dễ treo nhất. Ở mức `edits`, mỗi lệnh `python ...` của bot sẽ thành một thẻ xin duyệt trong app, mà nhân viên Telegram không bấm được.

- [ ] Giai đoạn đầu: bot kiểm kê chạy mức `full`, thư mục làm việc là `workspace` riêng, không chứa `.env` hay mã nguồn. Bot cũ cũng đang chạy không có người duyệt (`acceptEdits` kèm danh sách công cụ cho phép).
- [ ] Nếu lượt đang chờ một thẻ duyệt: báo chat admin "bot đang chờ duyệt trong app" để không ai phải đoán.
- [ ] Việc để sau: danh sách tiền tố lệnh được tự duyệt theo bot (ví dụ chỉ `python tools/...`), để hạ được xuống mức `edits`.

### 3.7 Route

Tài khoản (route riêng `/api/channels`, vì `/api/apps/{slug}/...` đã thuộc về Composio):

- [ ] `GET /api/channels`: mỗi kênh có `connected`, `accounts: [{id, label, username, state, error, usedBy: [botId]}]`.
- [ ] `POST /api/channels/{app}/accounts` với `{label, token}`: gọi `getMe`, lưu token, bắt đầu nhận tin, trả `@username` ngay để biết token đúng hay sai. Trả 409 nếu trùng nhãn, trùng token, hoặc đã đủ 5 tài khoản.
- [ ] `PATCH /api/channels/{app}/accounts/{id}` (đổi nhãn, thay token), `DELETE /api/channels/{app}/accounts/{id}` (chỉ gỡ tài khoản này).

Cấp quyền:

- [ ] `GET /api/channels/{app}/accounts/{id}/grants`, `PUT .../grants/{botId}` (bật và cấu hình), `DELETE .../grants/{botId}` (thu quyền). `PUT` trả 409 kèm tên bot đang giữ chat nếu trùng chat trong cùng tài khoản.
- [ ] `GET /api/bots/{id}/channels`: các tài khoản (Telegram, Zalo) bot này đang được cấp, để vẽ phần cài đặt của bot.
- [ ] `GET /api/channels/{app}/accounts/{id}/batches` (nhật ký lô, lọc theo bot), `POST /api/channels/batches/{id}/retry`, `.../cancel`.

`{app}` là `telegram` hoặc `zalo`; mọi route trên dùng chung cho cả hai.

### 3.8 Bộ nối Zalo Bot

Theo tài liệu Zalo Bot Platform (<https://docs.zaloplatforms.com/docs/BOT>). API có dạng `POST https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>` với thân JSON, gần giống Telegram, nên dùng chung khung với bộ nối Telegram.

- [ ] Kết nối: gọi `getMe` để kiểm token và lấy tên bot. Token lấy từ OA "Zalo Bot Manager" trong ứng dụng Zalo (tên bot phải bắt đầu bằng "Bot").
- [ ] Nhận tin bằng `getUpdates` (tham số `timeout`, mặc định 30 giây). Tài liệu không có tham số `offset`, nên chống trùng bằng `message_id` đã xử lý (lưu theo tài khoản).
- [ ] Nếu tài khoản đang đặt webhook thì `getUpdates` không chạy: báo rõ trên dòng tài khoản và có nút gọi `deleteWebhook`, không tự xoá.
- [ ] Sự kiện nhận: `message.text.received` (`text`), `message.image.received` (`photo_url`, `caption`). Tải ảnh từ `photo_url` ngay khi nhận, vì không rõ đường dẫn sống bao lâu. Sticker, voice và `message.unsupported.received` chỉ trả lời "chưa hỗ trợ".
- [ ] Gửi: `sendMessage` (tối đa 2.000 ký tự, tin dài thì cắt thành nhiều tin), `sendChatAction` trong lúc lô đang chạy.
- [ ] Không có nút bấm: mọi thao tác là lệnh chữ `/kiemke`, `/huy`, `/thulai`, `/tomtat`, `/id`, `/help`. Không sửa được tin đã gửi, nên trạng thái lô là tin mới, gộp tối đa một tin mỗi 5 giây.

Giới hạn của Zalo Bot ảnh hưởng tới bot kiểm kê:

| Việc | Telegram | Zalo Bot | Cách xử lý ở Zalo |
|---|---|---|---|
| Nhận ảnh | Có, cả dạng File không nén | Có, qua `photo_url` | Dùng được |
| Nhận PDF phiếu | Có | **Không** (không có sự kiện file) | Lấy bảng slot từ nguồn khác, xem dưới |
| Gửi phiếu PDF | `sendDocument` | **Không** (chỉ chữ, ảnh, sticker, voice) | Gửi tóm tắt bằng chữ; phiếu PDF giao qua kênh khác, xem dưới |
| Gửi ảnh | Tải file lên | `sendPhoto` nhận **đường dẫn** ảnh | Không dùng ở giai đoạn đầu (server chạy nội bộ, không có URL công khai) |
| Nút bấm, sửa tin | Có | Không | Lệnh chữ, tin trạng thái mới |
| Nhóm chat | Có | Đang thử nghiệm; bot chỉ nhận tin khi được @nhắc hoặc được trả lời | Dùng chat riêng 1-1 giữa nhân viên và bot |
| Nhận tin | Long polling, dùng được cho chạy thật | `getUpdates` được khuyên chỉ dùng khi phát triển; chạy thật nên dùng webhook | Bắt đầu bằng `getUpdates`; webhook là việc để sau |

Hai việc phải làm thêm để Zalo dùng được cho kiểm kê:

- [ ] **Bảng slot không cần PDF.** Lưu cấu hình slot của từng máy trong `<cwd>\machines\<mã máy>.json` (tạo từ lần gần nhất nhận PDF qua Telegram hoặc tải lên trong app). Ở Zalo, nhân viên gõ mã máy (ví dụ `/may BH-FLEX-M1`) trước khi gửi ảnh; `prepare.py` lấy `slots.json` từ file này khi lô không có PDF.
- [ ] **Giao phiếu PDF qua kênh khác.** Chat admin trong phần cấp quyền được chọn theo cặp (tài khoản, chat) của bất kỳ kênh nào. Lô đến từ Zalo vẫn có thể gửi phiếu PDF cho chat admin Telegram; nếu không có chat admin nào nhận được file thì phiếu nằm trong `out\` và mở được từ thread của lô trong app.

Việc để sau: chế độ webhook cho Zalo (`setWebhook`, kiểm header `X-Bot-Api-Secret-Token`) dùng lại cổng nhận webhook 8900, cần một URL HTTPS công khai.

Cần kiểm chứng bằng token thật trước khi viết bộ nối, vì tài liệu không nói rõ: `getUpdates` có luôn trả một sự kiện mỗi lần gọi như ví dụ mẫu không (trường `result` trong ví dụ là một sự kiện, không phải danh sách), một lần gửi nhiều ảnh thành mấy sự kiện, `photo_url` có hết hạn không và ảnh có bị nén không, `sendPhoto` có nhận tải file lên không, giới hạn tần suất, và bot có được nhắn trước cho người chưa từng nhắn nó không.

## 4. Giao diện web

### 4.1 Hộp thoại Connect apps có ba tab

| Tab | Nội dung | Trạng thái |
|---|---|---|
| **Connected apps** | App qua Composio: khoá dự án, tìm app, Connect / Add account, Disconnect theo từng tài khoản | Đã chạy, giữ nguyên |
| **Custom MCP servers** | Danh sách và trình sửa MCP server riêng (`McpServersView`), trước đây là hộp thoại riêng mở từ nút ở chân | Đã chạy, chỉ đổi chỗ |
| **Input** | Telegram bot và Zalo bot: nhận tin và tự bắt đầu bot | **Làm ở Phase 6** |

- [x] Khung ba tab (`role="tablist"`, mở lại hộp thoại thì về tab đầu) và tab Input dạng chờ: hai dòng Telegram bot / Zalo bot có nhãn "Coming soon", nút Connect bị khoá, và ba giới hạn của Zalo. Phần này đang nằm trong working tree, **chưa commit**, ở `ConnectedApps.tsx`, `McpServers.tsx`, `Shell.tsx`, `state/store.tsx`.
- [ ] Commit khung ba tab kèm test e2e: chuyển tab, nút "Custom MCP servers" cũ (`data-testid="open-mcp"`) vẫn mở đúng nội dung, bàn phím đi được giữa các tab.
- [ ] Bản tham chiếu đặt MCP servers thành một nút ở góc màn hình Apps chứ không phải tab; ba tab là khác bản gốc có chủ ý, để có chỗ cho Input.

### 4.2 Tab Input (Phase 6)

Dùng lại kiểu hiển thị của tab Connected apps: dòng app, **Add account**, ô nhãn, mỗi tài khoản một dòng có **Disconnect**. Tab này không cần khoá Composio. Khi làm xong thì bỏ nhãn "Coming soon" và mở nút Connect. Dòng Telegram bot:

- [ ] Chưa có tài khoản: nút **Connect**. Đã có: tên app, dấu tích, chồng avatar các bot đang dùng, nút **Add account** bên cạnh.
- [ ] Connect / Add account mở ô nhập ngay trong dòng: nhãn (bắt buộc, không trùng) và token. Khác app Composio ở chỗ không mở trang đăng nhập ngoài. Lưu xong hiện `@username`.
- [x] Dòng chú thích đầu tab phân biệt với mục Telegram của Composio (đã có trong khung): Input nhận tin và tự chạy bot; mục Telegram ở tab Connected apps chỉ cho bot công cụ để gửi.
- [ ] Dòng **Used by <tên các bot>** kèm liên kết **Change** mở bộ chọn bot được dùng.
- [ ] Mỗi tài khoản một dòng: dấu trạng thái, nhãn, `active` hoặc lỗi, nút **Disconnect** của riêng dòng đó.
- [ ] Hướng dẫn ngắn: tắt privacy mode ở BotFather, thêm bot vào nhóm, gõ `/id` để lấy mã chat.

Dòng **Zalo bot** nằm dưới Telegram bot, cùng cách hiển thị và cùng các nút. Khác ở hướng dẫn: tạo bot trong OA "Zalo Bot Manager", nhân viên nhắn riêng cho bot rồi gõ `/id` để lấy mã chat. Thẻ ghi rõ ba giới hạn: không nhận file PDF, không gửi được file, nhóm chat chưa dùng được.

### 4.3 Cấp quyền cho bot (Phase 6)

Mở từ **Change** trong tab Input, và từ phần "Apps and servers" của `BotPanel.tsx`:

- [ ] Chọn tài khoản theo nhãn, rồi bật/tắt cho từng bot.
- [ ] Khi bật: chat được phục vụ, chat admin, số ảnh tối đa, thời gian chờ, giờ nhắc, lời nhắc mẫu.
- [ ] Cảnh báo tại chỗ khi bot chưa có thư mục làm việc hoặc engine không đọc được ảnh, và khi chat đã thuộc bot khác.
- [ ] Nhật ký lô của bot: trạng thái, số file, thời lượng, liên kết mở thread của lô.
- [ ] Chuỗi mới thêm vào các file ngôn ngữ; kiểm lại độ tương phản trên các skin như các trang khác.

## 5. Bộ kiểm kê trong `maybanhang_03`

Phần xử lý cố định vẫn là code, bot gọi qua dòng lệnh.

- [ ] `workspace\tools\prepare.py <job>`: đọc `files\*.pdf` bằng `pdf_parser.py`, ghi `slots.json`. PDF không đọc được thì thoát với mã lỗi và thông báo rõ.
- [ ] `workspace\tools\report.py <job>`: kiểm `counts.json` theo đúng quy tắc `_validate` cũ (đủ ít nhất một nửa số slot), tính chênh lệch, dựng `out\BC_KiemKe_<máy>_<ngày>.pdf` bằng mẫu `phieu.html.j2`. Sai schema thì thoát với mã lỗi để bot sửa và chạy lại.
- [ ] Sửa `AGENTS.md` và `SKILL.md`: thứ tự bắt buộc là `prepare.py` → đếm từng slot → ghi `counts.json` → `report.py`; trả lời cuối là một dòng "Đã kiểm kê xong máy <mã>".
- [ ] Gắn skill cho bot: thử cả hai cách (skill trong `workspace\.claude\skills\` do Claude tự nạp, và skill gắn qua phần Skills của bot) rồi chọn cách chạy ổn định. Bot cũ từng phải ép Claude gọi skill, nên đây là mục cần kiểm chứng sớm.
- [ ] `venv` có Pillow, pdfplumber, Jinja2, Playwright phải nằm trên `PATH` của engine (bot cũ tự chèn vào; ở BotTeam cần đặt trong môi trường khởi chạy server hoặc gọi thẳng `..\venv\Scripts\python.exe` trong hướng dẫn).
- [ ] Bỏ: `handlers.py`, `runner.py`, `codex_home.py`, `main.py`, `n8n_cli.py`, `config.py` (phần Telegram và AI), hai workflow n8n, phần Telegram trong `install.bat` và `start.bat`. Giữ: `pdf_parser.py`, `report.py`, `templates\`, `workspace\`, dữ liệu `data\`.

## 6. Kiểm thử

- [ ] `server/tests/test_telegram.py` với Telegram giả (máy chủ `httpx` giả trả `getUpdates`, nhận `sendMessage`, `sendDocument`) và driver `echo`:
  - chat chưa cấp cho bot nào bị bỏ qua (trừ `/id`); hai bot cùng dùng một tài khoản, mỗi chat tới đúng bot của nó;
  - hai tài khoản chạy cùng lúc: tin tới tài khoản nào thì trả lời bằng tài khoản đó, cùng một mã chat ở hai tài khoản có thể thuộc hai bot khác nhau;
  - trùng nhãn, trùng token, tài khoản thứ sáu đều bị từ chối và không ghi đè tài khoản đang có;
  - cấp một chat cho bot thứ hai trong cùng tài khoản bị từ chối; gỡ một tài khoản thì chỉ quyền và việc nhận tin của tài khoản đó dừng;
  - PDF và ảnh rơi đúng thư mục, không lượt nào bắt đầu trước khi bấm Kiểm kê;
  - bấm Kiểm kê tạo đúng một lượt, lời nhắc có đường dẫn lô;
  - `out\` có file thì admin nhận file và người gửi chỉ nhận tin ngắn;
  - `out\` rỗng, hết giờ, engine không sẵn sàng đều thành `failed` kèm nút Thử lại;
  - hai lô cùng lúc chạy lần lượt;
  - khởi động lại không xử lý trùng update;
  - token không bao giờ xuất hiện trong phản hồi API hay frame.
- [ ] `server/tests/test_zalo.py` với Zalo giả: ảnh từ `photo_url` rơi đúng thư mục lô; cùng một `message_id` đến hai lần chỉ xử lý một lần; `/kiemke` bắt đầu đúng một lượt; tin dài hơn 2.000 ký tự được cắt; lô từ Zalo gửi phiếu PDF tới chat admin Telegram; tài khoản đang đặt webhook hiện lỗi rõ ràng và không tự xoá webhook.
- [ ] Test `prepare.py` lấy bảng slot từ `machines\<mã máy>.json` khi lô không có PDF.
- [ ] Test `prepare.py` và `report.py` bằng PDF và `counts.json` mẫu, không cần AI.
- [ ] Chạy thật một lần với bộ ảnh chuẩn trên cả Claude và Codex, so số đếm với bot cũ.

## 7. Thứ tự làm

| Giai đoạn | Nội dung | Kết quả kiểm chứng được |
|---|---|---|
| 1 | Mục 3.1–3.5, 3.7 và test với Telegram giả | Gửi ảnh vào nhóm thử, bấm Kiểm kê, bot trả lời trong Telegram |
| 2 | Mục 5 (script, skill) và mục 3.6 | Ra phiếu PDF đúng mẫu từ bộ ảnh chuẩn |
| 0 | Mục 4.1: commit khung ba tab của hộp thoại Connect apps (tab Input còn ở dạng chờ) | Ba tab chuyển được, hai tab cũ chạy như trước |
| 3 | Mục 4.2 và 4.3 (tab Input hoạt động, cấp quyền trong cài đặt bot) và các quy tắc riêng của kiểm kê ở 3.3 | Kết nối và cấp quyền hoàn toàn trong app, không sửa file tay |
| 4 | Chạy song song với bot cũ bằng token thử, rồi chuyển token thật | Tắt bot cũ, xoá phần code đã liệt kê ở mục 5 |
| 5 | Mục 3.8: thử API Zalo bằng token thật, bộ nối Zalo, bảng slot theo máy, giao phiếu qua kênh khác | Nhân viên nhắn riêng bot Zalo, gửi ảnh, gõ `/kiemke`, nhận tóm tắt; admin nhận phiếu PDF qua Telegram |

Giai đoạn 1 dựng sẵn khung chung `channels/base.py`, để giai đoạn 5 chỉ thêm `zalo.py` mà không sửa lại phần Telegram.

Một token Telegram chỉ có một tiến trình nhận tin, nên trong lúc chạy song song phải dùng một bot Telegram thử riêng (thêm thành một tài khoản có nhãn `thu`).

## 8. Điểm cần bạn quyết

1. **Ai chạy `prepare.py` và `report.py`?** Plan này để bot (AI) tự chạy, giúp kênh Telegram dùng được cho mọi loại bot. Cách khác là server chạy hai lệnh cố định trước và sau lượt AI: chắc chắn hơn nhưng phải thêm cấu hình "lệnh trước/sau" cho từng bot.
2. **Mức duyệt `full` cho bot kiểm kê** ở giai đoạn đầu có chấp nhận được không, hay phải làm danh sách lệnh tự duyệt ngay.
3. **Có cần chat tự do qua Telegram không** (mỗi tin là một lượt, không gom lô)? Plan này chỉ làm chế độ gom lô.
4. **Dữ liệu cũ** trong `maybanhang_03\data\` giữ nguyên chỗ, hay chuyển về cùng thư mục lô mới.
5. **Telegram có mặt ở hai nơi có chấp nhận được không?** Mục Telegram của Composio (đã có, để bot gửi) và kênh Telegram (mới, để nhận tin). Cách khác là ẩn mục Telegram của Composio khi đã có kênh, và cho bot công cụ gửi tin riêng của kênh.
6. **Zalo dùng cho kiểm kê hay chỉ để chat?** Vì Zalo không nhận và không gửi được file, kiểm kê qua Zalo cần bảng slot lưu sẵn theo máy và một kênh khác để giao phiếu PDF. Nếu bạn chỉ cần Zalo để hỏi đáp bằng chữ và ảnh thì bỏ được hai việc này.
8. **Cấu hình nhận tin đặt ở đâu?** Bản gốc tách ba chỗ: kết nối ở Apps, quyền ở cài đặt bot, còn "khi có sự kiện thì bot làm gì" là một automation loại app event trong trang Automations. Plan này đang gộp phần thứ ba (chat, lời nhắc mẫu, giới hạn lô) vào phần cấp quyền. Tách ra thành automation thì giống bản gốc hơn, đổi lại phải khai báo thêm một bước.
7. **Zalo chạy thật bằng `getUpdates` có chấp nhận được không?** Tài liệu Zalo khuyên dùng webhook cho chạy thật để không sót sự kiện; webhook cần một URL HTTPS công khai trỏ về máy chạy BotTeam.
