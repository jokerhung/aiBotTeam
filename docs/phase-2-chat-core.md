# Phase 2 — Lõi chat với agent thật

**Mục tiêu:** vòng lặp chính chạy trọn: tin nhắn → agent CLI → trả lời dạng stream → tool chip → kết thúc lượt. Chọn model theo bot, dừng lượt, nhiều task/thread cho mỗi bot.

**Tham chiếu:** `server/contracts.ts`, `shared/runtime-events.ts`, `server/drivers/claude.ts`, `codex.ts`, `openai-chat.ts`, `openai-compat.ts`, `server/harness/registry.ts`, `bus.ts`, `live-steps.ts`; `src/components/ChatView.tsx`, `ChatMarkdown.tsx`, `CodeBlock.tsx`, `ModelPicker.tsx`, `ProviderIcons.tsx`, `TurnPresence.tsx`, `TaskPicker.tsx`, `MessageActions.tsx`. Ảnh: `model-picker.png`, `computer-panel.png` (tool chip).

## 1. Registry và vòng đời engine

- [ ] `registry.py`: `InstanceConfig` (driver, displayName, enabled, hidden, environment, config) → instance sống; snapshot trạng thái `available` / `unavailable` kèm lý do (thiếu CLI, chưa đăng nhập).
- [ ] Dò CLI trên PATH (`claude`, `codex`), đọc phiên bản, cho phép chỉ đường dẫn binary tuỳ chỉnh.
- [ ] Driver lạ hoặc lỗi khởi tạo → instance "unavailable", không ném lỗi ra ngoài.
- [ ] Route: `GET /api/instances`, `PATCH /api/instances/{id}`, `POST /api/instances/{id}/check`; danh mục model theo instance.
- [ ] Màn `NoEngines` khi không engine nào sẵn sàng.

## 2. Driver

**Claude CLI** (`drivers/claude.py`) — tiến trình dài theo thread:

- [ ] Khởi chạy: `claude --output-format stream-json --input-format stream-json --verbose --include-partial-messages --permission-mode <mode> [--model …] [--resume <sessionId>] [--mcp-config <file>]`.
- [ ] Ghi tin người dùng vào stdin dạng JSON từng dòng; đọc stdout từng dòng.
- [ ] Ánh xạ khung gốc → `RuntimeEvent`:

  | Khung của CLI | RuntimeEvent |
  |---|---|
  | `system` / init | `session.started` (sessionId, model) |
  | `stream_event` text delta | `content.delta` (`assistant_text`) |
  | `stream_event` thinking delta | `content.delta` (`reasoning_text`) |
  | khối `tool_use` | `item.started` (`tool`, title, summary, input rút gọn) |
  | `tool_result` | `item.completed` (`tool`, ok, output) |
  | tin assistant hoàn chỉnh | `item.completed` (`assistant_text`) |
  | `result` | `turn.completed` (ok, usage, cost) |
  | lỗi / thoát bất thường | `runtime.error`, `session.exited` |

- [ ] Lưu `resumeCursor` (session id) theo thread; `sessionReset` để bắt đầu sạch.
- [ ] `interrupt_turn`: gửi yêu cầu ngắt qua stdin, quá hạn thì kết thúc tiến trình (trên Windows dùng `CTRL_BREAK_EVENT` rồi `terminate`).
- [ ] `steer`: đưa tin mới vào lượt đang chạy; trả `steered` / `refused` / `indeterminate`.
- [ ] System prompt = persona của bot (tên, chức danh, mô tả, "soul").

**Codex CLI** (`drivers/codex.py`): giao thức JSON-RPC của app-server; cùng bảng ánh xạ; đánh dấu `capabilities` đúng thực tế.

**Tương thích OpenAI** (`drivers/openai_compat.py`): HTTP streaming tới `/chat/completions`, phát lại transcript mỗi lượt (không có session gốc), dùng cho Ollama/OpenRouter/endpoint riêng.

- [ ] `capabilities` mỗi driver: `sessionModelSwitch`, `images`, `effortLevels`, `queueing`, `customMcp`…; UI đọc cờ, không đọc tên driver.
- [ ] Thử lại có kiểm soát: `turn.retrying` (attempt, delayMs, reason).

## 3. Điều phối lượt ở host

- [ ] `turns.py`: một lượt mỗi thread tại một thời điểm; tin đến khi đang bận thì steer, không được thì xếp hàng (`bot.queued`).
- [ ] Gộp `RuntimeEvent` thành `WireMessage`: tin `text` (ghép delta), tin `activity` cho mỗi tool (tên, ok, summary, input, output rút gọn), cập nhật bằng `message.patch`.
- [ ] Trạng thái bot: `busy`, `activity` (`working` / `waiting-on-you` / `idle` / `dead`), `turnStartedAt` — phát qua frame `bot`.
- [ ] Log NDJSON theo thread (`threads/<id>.ndjson`); sự kiện "chỉ sống" (`item.output`, tiến độ) không ghi log.
- [ ] Cộng dồn usage theo lượt từ `turn.completed.usage` (không cộng `thread.token-usage.updated`).
- [ ] Route: `POST /api/bots/{id}/interrupt`; `GET /api/threads/{id}/events` cho Inspector (phase 5).

## 4. Giao diện chat

- [ ] **Stream:** chữ hiện dần, con trỏ nhấp nháy (`--animate-caret`), tin mới trượt vào (`--animate-msg-in`).
- [ ] **Dòng trạng thái lượt** (`TurnPresence`): mascot + cụm từ đang làm ("Thinking…", tên tool), hiệu ứng `.thinking-shimmer`, bộ đếm thời gian.
- [ ] **Tool chip:** viên thuốc chữ mono có dấu ✓ / ✕ / vòng xoay (`ToolSearch`, `mcp__…`), bấm để xem input/output.
- [ ] **Markdown** (`ChatMarkdown`): `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex`; bảng dạng thẻ, khối mã có `shiki` hai bảng màu theo `--code-color-scheme`, nút chép; mermaid tải lười.
- [ ] **Cuộn:** bám đáy khi đang ở đáy, nút "xuống cuối" khi cuộn lên, tải trang cũ khi chạm đỉnh (ảo hoá bằng `@tanstack/react-virtual` nếu > 500 hàng), vạch "chưa đọc".
- [ ] **Hành động trên tin** (`MessageActions`): chép, thử lại, sửa tin người dùng (tạo nhánh qua `parentId`, đổi nhánh bằng frame `thread`).
- [ ] **Nút Dừng** trong composer khi bot bận; hàng "đã dừng" (`CancelledTurnRow`).
- [ ] **Banner lỗi** (`ChatErrorBanner`): lỗi cài đặt, hết hạn mức (kèm giờ đặt lại), engine im lặng.

## 5. Model picker

Theo `ModelPicker.tsx` và `model-picker.png`:

- [ ] Nút viên thuốc ở header: icon provider + tên model + mũi tên.
- [ ] Popover hai cột: **dải provider** bên trái (icon hoặc 2 chữ cái, mục chọn có nền), **danh sách model** bên phải với tiêu đề provider + phiên bản CLI, nhãn `default`, dấu ✓ ở model đang dùng.
- [ ] Provider không dùng được thì mờ đi kèm lý do.
- [ ] Mức effort / biến thể model khi driver hỗ trợ.
- [ ] Đổi model giữa cuộc trò chuyện: `PATCH /api/bots/{id}` với `modelSelection`; driver đổi trong phiên hoặc mở phiên mới tuỳ `sessionModelSwitch`.

## 6. Task / thread

- [ ] Mỗi bot có thread chính và nhiều task; nút `+ Task` tạo thread mới với model/quyền riêng.
- [ ] `TaskPicker`: danh sách task, đổi tên, đóng, ghim.
- [ ] Route: `GET/POST /api/bots/{id}/tasks`, `PATCH/DELETE /api/bots/{id}/tasks/{threadId}`; frame `bot` mang `threadId` hiện hành.
- [ ] Sự kiện của thread không hiển thị được đệm lại (`backgroundThreadEvents`) và áp khi quay về.

## 7. Kiểm thử

- [ ] Bản ghi khung thật của Claude/Codex (đã lọc bí mật) làm fixture; test ánh xạ → `RuntimeEvent` → `WireMessage`.
- [ ] Kịch bản: ngắt giữa lượt, CLI chết giữa chừng, steer bị từ chối, resume sau khi khởi động lại server.
- [ ] So ảnh: tin markdown dài, tool chip ba trạng thái, model picker mở, dòng trạng thái lượt.
- [ ] Test tay với CLI thật trên Windows và macOS.

## Tiêu chí hoàn thành

1. Bot dùng Claude CLI trả lời dạng stream, hiện tool chip khi gọi tool, lượt kết thúc đúng trạng thái.
2. Đổi sang Codex hoặc endpoint tương thích OpenAI bằng model picker, tin kế tiếp dùng model mới.
3. Dừng lượt đang chạy trong ≤ 2 giây, không để tiến trình mồ côi.
4. Khởi động lại server → mở lại bot vẫn còn transcript, tin kế tiếp nối đúng phiên CLI.
5. Hai thread của cùng một bot chạy độc lập.
6. So ảnh các màn mục 7 đạt ngưỡng.

## Cập nhật sau đối chiếu (2026-11-10)

- **Header Simple không có `+ Task`.** Mở hội thoại/thread qua `ChatHeadPill` → bot panel, tab Conversations (`bot-panel/Conversations.tsx`); sidebar có `SidebarActiveThreads` khi bot có việc đang chạy.
- **Model picker:** làm `SimpleModelMenu` trước (viên thuốc `h-8` ở header; "Thinking" gập thành một dòng như "Auto"); `ModelPicker` hai cột có dải provider là Advanced, làm ở phase 5.
- **Tool chip / dòng tiến độ:** Simple dùng `ToolActivity`, `NowCard`, `TurnPresence`; xem `ActivityRun.tsx` cho phần Advanced.
- Phần driver, registry, ánh xạ `RuntimeEvent` không đổi.


## Trạng thái thực hiện (2026-11-10)

**Kết quả kiểm chứng:** pytest 28 test xanh, Vitest 12 test xanh, `tsc` sạch. Chạy thật trên trình duyệt: Codex GPT-6-Luna trả lời stream, lượt thứ hai nhớ ngữ cảnh (resume đúng), tool chip, markdown/bảng/code/toán, model menu, tạo task. **Claude CLI trên máy này chưa đăng nhập** (`claude auth status` báo `loggedIn: false`), nên driver Claude chỉ được kiểm bằng CLI giả (`server/tests/fake_claude.py`) và định dạng khung theo parser gốc; chưa chạy lượt Claude thật.

### Đã làm theo kế hoạch
- **Mục 1 Registry:** `registry.py` (Claude, Codex, openai-compat, echo), dò CLI bằng `shutil.which`, đọc phiên bản, trạng thái đăng nhập (`claude auth status` JSON, `codex login status`), model catalog (Codex đọc `~/.codex/models_cache.json`), engine hỏng thành `unavailable` kèm lý do. Route `GET/POST /api/instances`, `PATCH /api/instances/{id}`, `POST …/check`; khoá endpoint tự thêm lưu trong `config.json`, không bao giờ trả về.
- **Mục 2 Driver:** `drivers/claude.py` (tiến trình `claude -p` stream-json theo thread, `--resume`, steer qua stdin, ngắt bằng kill cây tiến trình, dùng lại tiến trình giữa các lượt, khởi động lại khi đổi model/persona), `drivers/codex.py`, `drivers/openai_compat.py` (SSE stream, phát lại transcript), `drivers/echo.py` (kịch bản `/tool` `/slow` `/error` `/md`). `capabilities` mỗi driver; `turn.retrying` thử lại tối đa 2 lần (1s, 3s) khi tiến trình chết trước khi có đầu ra.
- **Mục 3 Điều phối:** `turns.py` với một đường ống sự kiện tuần tự; gộp thành tin `text`/`activity`/`error`/`stopped`; trạng thái bot (`busy`, `threadBusy`, `statusLine`, `turnStartedAt`); log NDJSON theo thread (không ghi `content.delta`); usage cộng theo `turn.completed`; steer rồi mới xếp hàng; Stop xoá hàng đợi; `GET /api/threads/{id}/events`.
- **Mục 4 Giao diện:** stream có con trỏ, dòng trạng thái lượt (`TurnPresence`, bộ đếm giây), tool chip ba trạng thái bấm mở xem input/output, markdown (gfm, math/KaTeX, shiki hai bảng màu theo skin, mermaid tải lười, bảng dạng thẻ, nút chép), cuộn bám đáy + nút "xuống cuối" + tải trang cũ khi chạm đỉnh + vạch "New" chưa đọc, hành động trên tin (chép, thử lại, sửa → nhánh, chuyển nhánh `‹ 1/2 ›`), nút Dừng/Gửi, tin xếp hàng mờ có nút gỡ, banner lỗi (setup có nút kiểm tra lại engine, hết hạn mức kèm giờ đặt lại), dải cảnh báo khi chưa có engine nào dùng được.
- **Mục 5 Model picker:** dạng Simple (`ModelMenu`): popover nhóm theo engine, nhãn `default`, dấu ✓, lý do khi engine không dùng được, hàng "Thinking" khi driver khai báo `effortLevels`. Đổi model giữa chừng qua `PATCH /api/bots/{id}`; Claude tự mở phiên mới (giữ `--resume`).
- **Mục 6 Task/thread:** bảng `threads`, `POST/GET/PATCH/DELETE /api/bots/{id}/tasks…`, `TaskMenu` mở từ pill ở header (không có nút `+ Task` vì là chế độ Simple): đổi chỗ, tạo, ghim, đổi tên, đóng, xoá; mỗi thread chạy độc lập, tự đặt tên từ tin đầu.
- **Nhánh:** `messages.parent_id` + `threads.leaf_id`, truy vấn nhánh hiện hành bằng CTE đệ quy, `PUT /api/threads/{id}/leaf`.

### Khác với kế hoạch (có chủ đích)
- **Codex dùng `codex exec --json` mỗi lượt** (+ `exec resume <thread_id>`), không dùng JSON-RPC của app-server. Không có steer và không có duyệt quyền theo từng lệnh; sandbox cố định `read-only` cho đến phase 3.
- **Claude chạy `--permission-mode default` không có công cụ duyệt**, nên lệnh cần quyền bị từ chối cho tới phase 3 (broker). Không dùng `--setting-sources project` vì làm mất cấu hình đăng nhập của người dùng.
- **Ảo hoá danh sách:** dùng `content-visibility: auto` cho các hàng cũ thay vì `@tanstack/react-virtual` (hàng cao thay đổi khi stream).
- **Không có ChatLoading/NoEngines toàn màn hình;** thay bằng dải cảnh báo phía trên.
- **Cổng** 5299/8899 (xem README).

### Chưa đạt / chưa kiểm
- **Lượt Claude thật** và test tay trên macOS (máy này Windows, Claude chưa đăng nhập).
- **So ảnh Playwright** với bản gốc (tiêu chí 6) chưa có hạ tầng; mới so bằng mắt.
- **Khôi phục sau khởi động lại giữa lượt:** tiến trình CLI bị giết cùng server; lượt đang chạy không tự chạy lại (runtime phase 4 sẽ xử lý). Transcript và `resume cursor` vẫn giữ nguyên.
- **Mục 7 kịch bản "CLI chết giữa chừng / steer bị từ chối"** đã có test với CLI giả; kịch bản bản ghi khung thật của Claude chưa có.
