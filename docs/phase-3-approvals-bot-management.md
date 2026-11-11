# Phase 3 — Duyệt quyền, quản lý bot, cài đặt

**Mục tiêu:** bot hỏi trước khi làm (thẻ Allow/Deny và thẻ câu hỏi ngay trong chat); quản lý bot như quản lý chat; modal cài đặt app với khoá API, skin; đính kèm file; tìm kiếm.

**Tham chiếu:** `shared/approval-mode.ts`, `shared/ask-question.ts`, `shared/command-allowlist.ts`, `server/permission-proxy.ts`, `server/auto-approve.ts`, `server/drivers/permission-command.ts`, `claude-elicitation.ts`; `src/components/ApprovalCard.tsx`, `AskCard.tsx`, `QuestionCard.tsx`, `PendingApproval.tsx`, `ApprovalModeSelector.tsx`, `BotSettingsDialog.tsx`, `bot-settings/`, `bot-panel/`, `NewBotDialog.tsx`, `SidebarBotMenu.tsx`, `SidebarSectionHeader.tsx`, `SettingsModal.tsx`, `keys/`, `CommandPalette.tsx`, `Composer*.tsx`, `AttachmentPreview.tsx`. Ảnh: `approval-card.png`, `context-menu.png`, `app-settings.png`, `agent-profile-desktop.png`.

## 1. Permission broker

Làm spike đầu phase: xác nhận Claude CLI gọi được công cụ MCP của ta khi cần quyền.

- [x] `mcp_bridge.py`: MCP server stdio do harness sở hữu, gắn vào mỗi lượt qua `--mcp-config`, cung cấp `approve` (dùng với `--permission-prompt-tool`) và `ask_user`.
- [x] `broker.py`: yêu cầu từ CLI → `request.opened` (`permission` | `question`, tool, summary, command + cwd, choices, questions) → chờ quyết định → `request.resolved` (behavior, source).
- [x] Mức duyệt theo bot/thread: `ask` < `edits` < `auto` < `full`; gửi lại mỗi lượt để phiên resume không giữ mức cũ rộng hơn.
- [x] Tự duyệt an toàn: danh sách lệnh chỉ đọc; "luôn cho phép" theo đúng lệnh + thư mục (`alwaysAllow`), không suy ra từ chuỗi hiển thị.
- [x] Fail-closed: không ai trả lời (client ngắt, lượt kết thúc) → `unavailable`, coi là từ chối.
- [x] Yêu cầu mở khoá sandbox (`requiresExplicitApproval`) chỉ mức `full` tự trả lời.
- [x] Route: `POST /api/threads/{threadId}/requests/{requestId}` với `{behavior, message?, always?}` (đối chiếu đường dẫn gốc trong `server/routes/`).
- [x] Codex: chạy qua `codex app-server` (JSON-RPC); yêu cầu duyệt lệnh và sửa file của Codex đi vào cùng broker với Claude (Allow/Deny/Always allow/tự duyệt), mỗi mức duyệt ánh xạ sang approvalPolicy + sandbox của Codex.

## 2. Thẻ trong chat

- [x] **ApprovalCard:** tên tool, lệnh ở khối mono, thư mục làm việc; nút `Allow` (accent), `Deny`, `Always allow` khi driver hỗ trợ; sau quyết định co lại thành một dòng ghi ai quyết định (người / tự động / hết hạn).
- [x] **AskCard / QuestionCard** (đúng `approval-card.png`): thẻ nền `card` bo 18, tiêu đề đậm, phụ đề, các hàng lựa chọn có ô chữ `A` `B` `C` `D`, ô "Type your own answer", nút đóng ✕. Phím A–D chọn nhanh.
- [x] Nhiều câu hỏi trong một yêu cầu (AskUserQuestion của Claude) → mỗi câu một nhóm lựa chọn.
- [x] Bot chuyển `activity: "waiting-on-you"`; sidebar hiện dấu cần chú ý; thông báo trình duyệt nếu tab ẩn.
- [x] **ApprovalModeSelector** trong composer / cài đặt bot: Ask · Edits · Auto · Full.

## 3. Quản lý bot

- [x] **NewBotDialog:** tên, chức danh, mô tả, màu/biểu cảm mascot, model, mức duyệt; gợi ý tên ngẫu nhiên; `GET/PUT /api/bot-defaults`.
- [x] **Menu chuột phải** (đúng `context-menu.png`, dùng shadcn `context-menu` ghi đè class): Pin · Make Chief of Staff · Move to new section · Mark as Unread │ Edit Profile · Duplicate │ Copy conversation ID │ Hide from sidebar · Delete (đỏ). Rộng 228px, bo 12, vạch chia giữa nhóm.
- [x] **Section:** nhóm bot có tiêu đề gập được, đổi tên, kéo-thả bot giữa section và sắp xếp (`/api/sidebar-sections`, `PUT /api/bots/order`).
- [x] **Ghim** lên đầu, **ẩn/lưu trữ** (`ArchivedBotsPanel`), **xoá** có xác nhận và hoàn tác ngắn.
- [x] **Chọn nhiều** (`BulkSelectBar`): xoá/ẩn hàng loạt.
- [x] **Panel cài đặt bot** (tab Computer duyệt thư mục làm việc chỉ-đọc; tab Library là ghi chú của bot, đưa vào chỉ dẫn mỗi lượt) (panel phải, trượt vào bằng `--animate-panel-in`): hồ sơ + trình sửa avatar, chỉ dẫn (soul), model + model dự phòng, quyền truy cập, thư mục làm việc (`cwd`), thông báo. Lưu qua hàng đợi patch (`bot-patch-queue.ts`) để gõ nhanh không mất thứ tự.
- [x] Bố cục khi mở panel: sidebar thu thành icon nếu cửa sổ không đủ rộng; hai panel cùng mở thì panel sau phủ lên.

## 4. Cài đặt app

Theo `SettingsModal.tsx` và `app-settings.png`:

- [x] Modal bo 16, cột trái là danh mục (General, Connections, Engines, Appearance…), cột phải là nội dung; nền mờ phía sau.
- [x] **Connections / Keys:** mỗi hàng có chấm trạng thái, nhãn, thẻ `OPTIONAL`, chữ "Connected", ô nhập, nút `Save` / `Clear` (đỏ), icon trợ giúp. Khoá chỉ ghi: sau khi lưu hiện `••••••••  (paste to replace)`.
- [x] `PUT /api/config` lưu khoá vào `config.json` (0600); registry nạp lại provider ngay, phát frame `config`.
- [x] **Engines:** danh sách CLI phát hiện được, trạng thái đăng nhập, đường dẫn binary tuỳ chỉnh, bật/tắt/ẩn, thêm endpoint tương thích OpenAI (`OpenAiCompatServers`).
- [x] **Appearance:** bộ chọn skin vẽ bản thu nhỏ sống của từng skin (mỗi ô là một subtree `[data-skin]`), phông chữ, độ rộng chat, giảm chuyển động.
- [x] **General:** tên hiển thị, chế độ giao diện Simple/Advanced, ngôn ngữ (đủ khung, nội dung ở phase 5).
- [x] Menu hồ sơ ở chân sidebar (`SidebarProfileMenu`), bảng phím tắt (`KeyboardShortcutsModal`).

## 5. Composer đầy đủ và đính kèm

- [x] Menu `+` (`ComposerPlusMenu`): đính file, ảnh, chọn thư mục.
- [x] Dán/kéo-thả ảnh và file; chip xem trước, xoá từng cái; chặn ảnh khi driver không có `capabilities.images`.
- [x] `POST /api/attachments` (giới hạn dung lượng theo `shared/upload-limits.ts`), `GET /api/attachments/{name}`; kho riêng trong `~/.botteam/attachments`, driver nhận đường dẫn đã duyệt chứ không phải đường dẫn tuỳ ý.
- [x] Hiển thị đính kèm trong transcript (`AttachmentGallery`, `AttachmentPreview`).
- [x] Tin xếp hàng khi bot bận (hiện mờ, sửa/xoá được trước khi gửi).
- [x] Bản nháp theo thread lưu `localStorage`.

## 6. Tìm kiếm và điều hướng

- [x] Ô Search ở sidebar: lọc bot theo tên; `GET /api/search?q=` tìm toàn văn trong tin (SQLite FTS5), bấm kết quả nhảy đến tin và tô sáng.
- [x] `ChatFindBar`: tìm trong cuộc trò chuyện hiện tại (Ctrl/Cmd+F).
- [x] `CommandPalette` (shadcn `command`, Ctrl/Cmd+K): nhảy tới bot, lệnh nhanh.
- [x] Phím tắt: Ctrl/Cmd+N bot mới, Ctrl/Cmd+Shift+N task mới, Ctrl/Cmd+1…9 chọn bot, `?` mở bảng phím tắt.

## 7. Kiểm thử

- [x] Broker: cho phép, từ chối, hết hạn, client ngắt giữa chừng, hai yêu cầu trùng id, tự duyệt theo danh sách lệnh.
- [x] Bảo mật: `GET /api/config` không bao giờ trả giá trị khoá; đường dẫn đính kèm không thoát khỏi kho.
- [x] So ảnh: `pnpm test:visual` dựng một stack cô lập, chạy engine demo qua thẻ câu hỏi, thẻ duyệt (mở và đã quyết), menu chuột phải, modal cài đặt (Connections, skin), panel cài đặt bot và màn chính trên cả 13 skin, rồi so với ảnh gốc trong `web/e2e/baseline` (ngưỡng 0,3% điểm ảnh khác); `pnpm test:visual:update` để cập nhật. Đối chiếu với tham chiếu: (1) `pnpm test:reference-shots` quét hình học từ `docs/screenshots/{approval-card,context-menu,app-settings}.png` của OpenMausBot (thẻ câu hỏi 840x346, 4 hàng 49 px, ô nhập 43 px; menu 228x374, hàng 37 px; modal cài đặt 860x559, cột trái 190 px, thẻ Keys 628 px) và so với DOM của ta ở 1440x900 (lệch tối đa 2 px, ngưỡng 3 px); (2) `pnpm test:reference` mở `localhost:5199` cùng bản của ta với bot "QA": hộp bố cục (lệch 0 px), các vùng không phụ thuộc dữ liệu trên cả 13 skin (≤ 3,2% điểm ảnh, ngưỡng 3%/4%), bot panel (rộng 320, thanh tab, nút tròn) và bộ chọn skin (13 ô 122x78, 4 cột, bước 152 px); (3) `pnpm test:noflash` kiểm tra không nháy skin, kể cả lần mở đầu tiên của một trình duyệt chưa lưu gì (skin được layout đọc từ backend lúc render).

## Tiêu chí hoàn thành

1. Bot ở mức `ask` chạy lệnh shell → thẻ duyệt hiện trong chat; Allow thì lệnh chạy, Deny thì bot nhận từ chối và nói lại.
2. Bot gọi `ask_user` → thẻ A/B/C; chọn hoặc gõ câu trả lời thì lượt chạy tiếp.
3. Mọi mục trong menu chuột phải hoạt động và đồng bộ qua SSE giữa hai tab.
4. Dán khoá API một lần → provider sáng lên ngay không cần khởi động lại; khoá không xuất hiện lại ở UI hay log.
5. Đổi skin tức thì, không nháy khi tải lại trang.
6. Gửi ảnh cho bot có model nhìn được ảnh và nhận mô tả đúng.
7. So ảnh các màn mục 7 đạt ngưỡng.

## Cập nhật sau đối chiếu (2026-11-10)

- **Cài đặt bot = bot panel**, không phải `BotSettingsDialog`: `bot-panel/PanelShell`, tab Details · Computer · Library, trang Memory/Settings/Conversations/Backup AIs, nút Share tròn, menu `ChatMoreMenu` thành các hàng. Mở bằng ChatHeadPill. `BotSettingsDialog` (accordion) chỉ cho Advanced.
- **Composer Simple:** `ComposerPlusMenu` (đính file, chip "Finish together", mức duyệt); mức duyệt hiện thành pill nhỏ chỉ khi khác mặc định, trên bot panel > Details có chọn đầy đủ (`ApprovalModeSelector` là bản Advanced).
- **Cài đặt app:** `SettingsModal` + `SettingsSimplePages` cho Simple; khoá API chỉ-ghi giữ nguyên.
- **Menu chuột phải hàng bot** (ảnh `context-menu.png`) vẫn đúng, nhưng hàng bot Simple dùng nút "Actions for {bot}" (`size-7`, hiện khi rê chuột/chạm) mở cùng menu.
- Thẻ Allow/Deny và thẻ câu hỏi A/B/C: giữ như đã mô tả.
