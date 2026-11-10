# BotTeam — Kế hoạch tổng thể

Xây lại ứng dụng tương tự [OpenMausBot](https://github.com/milind-soni/OpenMausBot) (bản tham chiếu `0.1.151`, đã clone tại `_reference/OpenMausBot/`) với:

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind v4 + shadcn/ui
- **Backend:** Python (FastAPI) thay cho harness server Node/TypeScript
- **Giao diện:** giống hệt bản gốc (bố cục, màu, khoảng cách, chuyển động)

Kế hoạch chia **5 phase**, mỗi phase kết thúc bằng một bản chạy được và kiểm chứng được.

| Phase | Tài liệu | Kết quả |
|---|---|---|
| 1 | [phase-1-foundation-ui-shell.md](phase-1-foundation-ui-shell.md) | Khung app giống hệt bản gốc, backend + SSE + CRUD bot |
| 2 | [phase-2-chat-core.md](phase-2-chat-core.md) | Chat thật với agent: streaming, tool chip, model picker |
| 3 | [phase-3-approvals-bot-management.md](phase-3-approvals-bot-management.md) | Thẻ duyệt/hỏi, cài đặt bot, cài đặt app, skin, đính kèm |
| 4 | [phase-4-teams-automations.md](phase-4-teams-automations.md) | Channel nhiều bot, bot giao việc cho nhau, lịch & webhook |
| 5 | [phase-5-extensions-polish.md](phase-5-extensions-polish.md) | Plugins/MCP, Computer panel, memory, i18n, đóng gói |

## 1. Bản gốc là gì

Một app chat kiểu Telegram, mỗi "liên hệ" trong sidebar là một AI agent thật (CLI `claude` / `codex` / `grok` chạy trên máy) với tên, tính cách, model, máy tính và app kết nối riêng.

Kiến trúc gốc gồm 2 tiến trình:

```
App React (5299) ──HTTP lệnh──▶ Harness server (127.0.0.1:8899)
        ◀──── một luồng SSE ────        │
                                        ├─ Driver registry ─▶ claude / codex / grok CLI
                                        ├─ Event bus (fan-in → SSE, log NDJSON theo thread)
                                        └─ Permission broker (CLI xin quyền → thẻ trong chat)
```

Nguyên tắc cốt lõi cần giữ nguyên:

1. **Client không có transport riêng.** Gửi lệnh bằng HTTP, nhận mọi thay đổi qua *một* luồng SSE (`/api/events`), gộp vào *một* reducer.
2. **Một dạng sự kiện chuẩn** (`RuntimeEvent`) cho mọi provider: `turn.started`, `content.delta`, `item.started/completed`, `request.opened/resolved`, `turn.completed`, `runtime.error`…
3. **Driver SPI nhỏ:** `sendTurn`, `interruptTurn`, `respondToRequest`, `steer?`, `onEvent`, `capabilities`. Driver lạ thì hiện "unavailable", không làm sập cả đội.
4. **Dữ liệu ở máy người dùng** (`~/.openmausbot` → của ta là `~/.botteam`): SQLite + file, khoá API chỉ ghi (UI chỉ thấy cờ "configured").

## 2. Quy mô và phạm vi

Bản gốc rất lớn: ~7.400 file, riêng `src/components` có 555 component (~97.000 dòng TSX), `server/index.ts` 15.500 dòng, 100+ module route. Không thể và không cần chép hết trong 5 phase.

**Trong phạm vi** (giữ đúng giao diện gốc):

- Khung app: sidebar bot, vùng chat, composer, panel phải, modal cài đặt
- Chat streaming với Claude CLI, Codex CLI và endpoint tương thích OpenAI
- Model picker có dải provider, thẻ duyệt quyền (Allow/Deny), thẻ câu hỏi (A/B/C…)
- Quản lý bot như chat: ghim, đánh dấu chưa đọc, sửa hồ sơ, nhân bản, ẩn, xoá, section
- Task/thread theo bot, channel nhiều bot, @mention, bot giao việc cho bot
- Automations: lịch (routine) + webhook, trang lịch
- Plugins: MCP server tuỳ chỉnh, Connected apps
- Computer panel (mức trình duyệt tích hợp), Inspector, Activity
- 13 skin, phông chữ, độ rộng chat, mascot con trỏ

**Ngoài phạm vi** (ghi rõ để không trôi phạm vi):

- Vỏ Electron, bản đóng gói macOS/Windows/Linux, tự cập nhật
- App iOS/Android, ghép nối điện thoại, relay, tunnel
- Cloud control plane, Team Cloud, thanh toán, tổ chức (`cloudflare/`, `enterprise/`)
- Máy tính đám mây Boat, Local VM, điều khiển máy thật qua Cua Driver
- Gọi thoại trực tiếp, TTS/STT (có thể thêm sau phase 5)
- Antigravity, Pi, OpenCode và các driver ít dùng

## 3. Kiến trúc đích

```
botteam/
├─ web/                      Next.js 15 (App Router), React 19, Tailwind v4, shadcn/ui
│  ├─ app/                   layout.tsx, page.tsx (shell), globals.css (token + skin)
│  ├─ components/ui/         primitive shadcn (dialog, popover, dropdown, context-menu…)
│  ├─ components/            Sidebar, ChatView, Composer, ModelPicker, ApprovalCard…
│  ├─ state/                 store.tsx (reducer), api.ts, sse.ts
│  └─ lib/                   skins.ts, mascot.ts, wire.ts (type sinh từ OpenAPI)
├─ server/                   Python 3.12, FastAPI, uvicorn
│  ├─ botteam/
│  │  ├─ main.py             app factory, lifespan
│  │  ├─ wire.py             model Pydantic = hợp đồng dây (WireBot, WireMessage, ServerFrame)
│  │  ├─ events.py           RuntimeEvent (union Pydantic có discriminator)
│  │  ├─ bus.py              event bus → SSE, log NDJSON theo thread
│  │  ├─ registry.py         cấu hình instance → driver sống
│  │  ├─ drivers/            base.py (SPI), claude.py, codex.py, openai_compat.py
│  │  ├─ broker.py           permission broker
│  │  ├─ runtime/            assignment (giao việc giữa bot) — phase 4
│  │  ├─ routes/             mỗi nhóm endpoint một module
│  │  └─ store/              SQLite (messages.db, runtime.db), config.json
│  └─ tests/
├─ docs/                     kế hoạch này
└─ _reference/OpenMausBot/   mã tham chiếu (không commit)
```

| Hạng mục | Lựa chọn | Lý do |
|---|---|---|
| Render | Next.js App Router, shell là client component | App là SPA điều khiển bằng SSE; server component chỉ dùng cho layout, font, skin trước lần vẽ đầu |
| API proxy | `rewrites` của Next: `/api/*` → `http://127.0.0.1:8899` | Giữ nguyên đường dẫn `/api/...` như bản gốc, không cần CORS |
| SSE | `EventSource` gọi **thẳng** backend ở dev nếu proxy Next đệm luồng | Rewrite của Next có thể buffer SSE; kiểm ở phase 1 |
| Backend | FastAPI + `sse-starlette` + `asyncio.create_subprocess_exec` | Async hợp với nhiều tiến trình CLI và luồng dài |
| Lưu trữ | SQLite (`aiosqlite`), WAL | Giống bản gốc (`messages.db`, `runtime.db`) |
| Hợp đồng dây | Pydantic → OpenAPI → `openapi-typescript` sinh `web/lib/wire.ts` | Một nguồn sự thật cho cả hai phía |
| Lịch | `croniter` + vòng lặp asyncio | Thay `croner` của bản gốc |
| MCP | SDK `mcp` của Python (server stdio cho công cụ duyệt quyền/hỏi/giao việc) | Bản gốc gắn công cụ `mcp__ogb__approve`, `ask_user`, `coordinate_bots` qua MCP |
| Kiểm thử | pytest (driver giả), Vitest, Playwright (so ảnh) | Xem mục 5 |

## 4. Chiến lược "giao diện giống hệt"

Điểm thuận lợi: bản gốc đã là **React 19 + Tailwind v4 + lucide-react**, nên đây là chuyển host (Vite → Next.js) và thay primitive tự viết bằng shadcn, không phải viết lại ngôn ngữ thiết kế.

1. **Chép nguyên token.** `src/styles.css` (3.474 dòng) → `web/app/globals.css`: khối `@theme`, 13 khối `[data-skin]`, keyframes, `.chat-md`, `.chat-column`, thanh cuộn, focus ring.
2. **Nối token vào shadcn.** Biến của shadcn trỏ về token gốc, không dùng bảng màu mặc định của shadcn:

   | shadcn | Token gốc | Midnight |
   |---|---|---|
   | `--background` | `--color-app` | `#121212` |
   | `--sidebar` | `--color-panel` | `#0e0e0e` |
   | `--card` | `--color-card` | `#1f1f1f` |
   | `--popover` | `--color-menu` | `#1f1f1f` |
   | `--muted` / `--secondary` | `--color-raised` | `#202020` |
   | `--accent` (hover) | `--color-raised-hover` | `#2c2c2c` |
   | `--border` | `--color-hairline` | `#383838` |
   | `--foreground` | `--color-ink` | `#f5f5f5` |
   | `--muted-foreground` | `--color-ink-secondary` | `#f5f5f5a8` |
   | `--primary` | `--color-accent` | `#1084fe` |
   | `--ring` | `--color-focus` | `#459ffe` |
   | `--destructive` | `--color-danger` | `#ff5667` |

3. **Giữ thang bo góc gốc:** chip/hàng menu 6, ô nhập/hàng sidebar 8, thẻ/menu 12, dialog 16, bong bóng 18, composer 22 (18 khi xuống dòng), khung cửa sổ 0.
4. **Thông số bố cục đo từ mã gốc:** sidebar 280px (Simple) / 320px (Advanced) / 80px (thu thành icon), kéo đổi rộng qua `--sidebar-width`; cột chat tối đa `60rem`; bong bóng tối đa `35rem` / 80%; chữ chat 15px, `line-height: 1.75`; phông Geist Variable + Geist Mono.
5. **Component shadcn dùng làm nền** (ghi đè class cho khớp, không đổi cấu trúc trực quan): `dialog`, `sheet`, `popover`, `dropdown-menu`, `context-menu`, `command`, `tooltip`, `tabs`, `toggle-group`, `switch`, `select`, `input`, `textarea`, `button`, `scroll-area`, `sonner`.
6. **Chép các phần vẽ tay:** mascot (`CursorAvatar.tsx`, `lib/mascot.ts`, `shared/mascot-bodies.ts`), `ProviderIcons.tsx`, `ChatMarkdown.tsx`, `CodeBlock.tsx`.
7. **So ảnh tự động.** Chạy bản gốc (`pnpm dev` + `pnpm dev:server`, cổng 5299) cạnh bản mới với cùng dữ liệu mẫu; Playwright chụp từng màn hình ở 1440×900 và 390×844, so bằng `pixelmatch`, ngưỡng sai khác ≤ 0,5% mỗi màn. Ảnh trong `_reference/OpenMausBot/docs/screenshots/` là mốc đối chiếu bằng mắt.

Mỗi phase có danh sách màn hình phải đạt ngưỡng so ảnh trước khi coi là xong.

## 5. Quy ước chung

- **Dữ liệu:** `~/.botteam/` (`config.json` quyền 0600, `messages.db`, `runtime.db`, `threads/<id>.ndjson`, `attachments/`). Biến `BOTTEAM_DATA_DIR` để chạy fixture cô lập khi test.
- **Cổng:** web 5299, API 8899 (webhook 8900) — cố ý khác bản gốc (5199/8799/8800) để chạy song song được với OpenMausBot trên cùng máy.
- **Bảo mật:** API chỉ nghe `127.0.0.1`; khoá API chỉ ghi; văn bản từ tool/trang web là dữ liệu, không phải chỉ thị; mặc định từ chối khi không ai trả lời yêu cầu quyền (fail-closed).
- **Kiểm thử driver:** mọi logic chạy trên "driver giả" phát lại kịch bản `RuntimeEvent`; test với CLI thật tách riêng, chạy tay.
- **Giấy phép:** bản gốc là Apache-2.0, được phép chép mã và giao diện nếu giữ `LICENSE`/`NOTICE` và ghi chú file đã sửa. Thư mục `enterprise/` có giấy phép riêng — **không chép**. Không dùng tên và logo "OpenMausBot/MausBot" làm thương hiệu sản phẩm; đặt tên riêng (BotTeam).

## 6. Rủi ro chính

| Rủi ro | Cách giảm |
|---|---|
| Giao thức `stream-json` của Claude CLI và JSON-RPC của Codex thay đổi theo phiên bản | Ghim phiên bản CLI đã kiểm, lưu `raw` trong event, test bằng bản ghi thật |
| Tiến trình con trên Windows (đường ống, tín hiệu dừng, PATH) | Dùng `asyncio` Proactor loop, dừng bằng `CTRL_BREAK_EVENT`/`terminate`, test trên Windows từ phase 2 |
| Luồng duyệt quyền phụ thuộc MCP (`--permission-prompt-tool`) | Làm sớm một spike ở đầu phase 3 trước khi dựng UI |
| Trôi phạm vi do bản gốc quá nhiều tính năng | Bám danh sách "ngoài phạm vi" ở mục 2; mỗi phase có tiêu chí hoàn thành cố định |
| Lệch pixel do khác primitive (Radix của shadcn so với menu tự viết) | So ảnh tự động mỗi phase; nơi lệch thì chép component gốc thay vì dùng shadcn |
