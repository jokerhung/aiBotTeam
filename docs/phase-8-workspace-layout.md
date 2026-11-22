# Phase 8 — Giao diện "workspace" theo agenticos

**Mục tiêu:** đổi khung giao diện của BotTeam sang bố cục của [agenticos](https://github.com/vstorm-co/agenticos): một **thanh điều hướng chính** bên trái gồm Dashboard, Chat, Inbox, Projects, Build (Agents, Workflows, Routines), Knowledge (Bases, Documents, Skills), Connect (Apps, Input); mục nào BotTeam chưa có thì **để trang trống** (trạng thái rỗng), không làm tính năng. Các tính năng đang có (chat, thẻ duyệt, lịch, kết nối, kênh Telegram/Zalo, kỹ năng, báo cáo chi phí) giữ nguyên và chỉ đổi chỗ đặt.

**Trạng thái:** đã triển khai trên nhánh `newgui` (mục 8 ghi chỗ khác kế hoạch và việc còn lại).

**Tham chiếu**

- Ảnh chụp giao diện agenticos mà người dùng đưa (3 cột: thanh điều hướng, danh sách "Chats", khung chat với thanh soạn tin có chọn agent và đồng hồ ngữ cảnh).
- Giao diện hiện tại: `web/components/Shell.tsx`, `Sidebar.tsx` (540 dòng: danh sách bot, nhóm, section, hộp thư, tìm kiếm, menu hồ sơ), `state/store.tsx` (các cờ `automationsOpen`, `teamMapOpen`, `inboxOpen`, `appsOpen`, `usageOpen`), `AutomationsPage.tsx`, `ConnectedApps.tsx`, `InputChannels.tsx`, `Observe.tsx` (`UsagePage`), `SkillsSection.tsx`, `NotificationsPanel.tsx` (`InboxPanel`), `app/page.tsx` (một trang duy nhất, xuất tĩnh).
- Quy tắc dự án: `AGENTS.md` số 2 (xem giao diện tham chiếu ở `http://localhost:5199/` trước khi đổi màn hình). Phase này **cố ý khác** bản tham chiếu OpenMausBot theo yêu cầu của người dùng; lý do ghi ở mục 9.

## 1. Bố cục đích

```
┌────────────┬───────────────┬───────────────────────────────────────┐
│ AppRail    │ ChatList      │ Nội dung chính                        │
│ (điều hướng)│ (chỉ ở Chat/  │ (chat, hoặc một trang đầy đủ)         │
│            │  Project)     │                                       │
└────────────┴───────────────┴───────────────────────────────────────┘
```

- **Cột 1 — AppRail** (rộng ~250 px, thu gọn còn biểu tượng): logo + nút thu gọn; ô Search `⌘K`; Dashboard, Chat, Inbox (có số chưa đọc); nhóm **Projects** (vài mục + "All projects"); nhóm **Build**; nhóm **Knowledge**; nhóm **Connect**; chân: chuông thông báo, nhãn phiên bản, thẻ người dùng (mở menu cài đặt, What's new, Team map).
- **Cột 2 — ChatList**: tiêu đề "Chats" với tìm kiếm, bộ lọc, nút tạo mới; nhóm "Unread", các project, "Today". Chính là nội dung `Sidebar.tsx` hiện nay (bot, nhóm bot, section) chuyển sang đây. Chỉ hiện khi đang ở Chat hoặc một Project; các trang khác dùng toàn bộ bề ngang.
- **Cột 3**: khung chat hiện có (`ChatView`, `GroupView`, panel phải) hoặc một **PageFrame** (tiêu đề, nút hành động, nội dung) cho các trang.

## 2. Menu và ánh xạ vào những gì BotTeam đã có

| Mục menu | Nội dung | Trạng thái |
|---|---|---|
| Dashboard | Chi phí và token theo ngày/bot/model, số lượt chạy, thẻ cần duyệt (từ `/api/usage`, `UsagePage`, hộp thư) | **Có dữ liệu**, chuyển từ hộp thoại sang trang |
| Chat | ChatList + `ChatView` | Có (chuyển danh sách bot sang cột 2) |
| Inbox | Thẻ chờ trả lời và thông báo (`InboxPanel`) | Có, thành trang |
| Projects | Nhóm bot (channel, `GroupView`), "All projects" liệt kê các nhóm | Có (project = nhóm bot) |
| Build → Agents | Danh sách và sửa bot (`BotPanel`, `NewBotDialog`, nhập/xuất bot) | Có, thành trang dạng bảng |
| Build → Workflows | — | **Trống** |
| Build → Routines | `AutomationsPage` (lịch, webhook, trang lịch) | Có |
| Knowledge → Bases | — | **Trống** (kho tri thức RAG làm ở phase sau) |
| Knowledge → Documents | — | **Trống** |
| Knowledge → Skills | Thư viện kỹ năng (`/api/skills`, `SkillsSection`) | Có, thành trang |
| Connect → Apps | `ConnectedApps` (Composio, MCP riêng) | Có, thành trang |
| Connect → Input | `InputChannels` (Telegram, Zalo, `intake.md`) | Có, thành trang |

Không đưa vào menu đợt này: Tables, Context, Activity (agenticos có; bạn không yêu cầu). Activity của từng bot vẫn nằm trong panel bot. Team map và What's new vẫn ở menu người dùng.

Từ ngữ trên giao diện: giữ tên của agenticos (Agents, Projects, Routines…) và thêm bản Việt (Bảng điều khiển, Trò chuyện, Hộp thư, Dự án, Xây dựng, Bot, Quy trình, Lịch chạy, Tri thức, Kho tri thức, Tài liệu, Kỹ năng, Kết nối, Ứng dụng, Đầu vào).

## 3. Thiết kế kỹ thuật

- **Một biến `view` thay cho các cờ rời.** Thay `automationsOpen`, `teamMapOpen`, `usageOpen`, `appsOpen`, `inboxOpen` bằng `view: "chat" | "dashboard" | "inbox" | "project" | "projects" | "agents" | "workflows" | "routines" | "bases" | "documents" | "skills" | "apps" | "input" | "team-map"`. Các action cũ (`automations`, `usage`, `teamMap`, `apps`, `inbox`) vẫn nhận và quy về `view`, để mã cũ và test cũ chạy tiếp.
- **Định tuyến bằng hash** (`#/dashboard`, `#/chat/<botId>`, `#/projects/<id>`, `#/build/routines`…): ứng dụng là một trang xuất tĩnh (`pnpm build:static`) nên không dùng route theo đường dẫn; hash cho phép nút Back/Forward, liên kết mở thẳng một trang và giữ vị trí sau khi tải lại.
- **Thành phần mới** trong `web/components/layout/`: `AppRail`, `NavItem`, `NavGroup`, `ChatList` (chuyển từ `Sidebar.tsx`), `PageFrame` (tiêu đề + hành động + vùng cuộn), `EmptyPage` (biểu tượng, tên, một câu "Chưa có tính năng này", không có nút giả).
- **Bảng cấu hình menu** một chỗ (`nav.ts`: id, nhãn, nhãn Việt, biểu tượng, `view`, cờ `placeholder`) để thêm trang sau này chỉ là đổi một dòng.
- **Trang có sẵn chuyển từ hộp thoại sang trang:** `UsagePage`, `ConnectedApps`, `InputChannels`, `InboxPanel` hiện là modal hoặc panel nổi. Tách phần ruột thành thành phần dùng được cả hai nơi; hộp thoại cũ gọi lại cùng thành phần để không viết hai lần.
- **Thu gọn và co giãn:** AppRail thu gọn còn biểu tượng (nhớ trong `localStorage`, có try/catch); dưới ~1024 px cột 2 thành ngăn kéo; dưới ~768 px AppRail thành ngăn kéo (dùng lại `drawerOpen`).
- **Giao diện:** giữ 13 skin và token màu hiện có (`--color-panel`, `--color-app`…); chỉ đổi kích thước, khoảng cách và bo góc theo ảnh agenticos (khung ngoài bo lớn, mục nav cao ~38 px, nhãn nhóm chữ nhỏ xám, mục đang chọn là nền bo tròn). Không thêm màu ngoài token.
- **Cờ để quay lại:** thêm `settings.layout = "workspace" | "classic"`, mặc định `workspace`; `classic` dùng `Sidebar` cũ. Gỡ `classic` sau một bản phát hành khi không còn lỗi.

## 4. Các bước

### 8.0 Chuẩn bị (không đổi mã)
- [x] Ghi lại kích thước và khoảng cách của ảnh agenticos (rộng menu, cao mục, cỡ chữ, màu) vào `docs/verification/layout-tokens.md`. (Không dùng `http://localhost:5199/` nữa theo `AGENTS.md`.)
- [ ] Chụp ảnh "trước" của các màn hình sẽ đổi (chat, nhóm, lịch, apps, input, usage, hộp thư) để so sánh sau. **Chưa làm.**
- [x] Chốt từ ngữ Việt của các mục menu với người dùng. (dùng bản đề xuất ở mục 2; sửa ở `web/lib/nav.ts` và `i18n-vi.ts`)

### 8.1 Khung và điều hướng
- [x] Biến `view` trong `store.tsx`, ánh xạ các action cũ, test reducer (Vitest) cho mọi chuyển đổi, gồm việc chọn bot đưa về `chat`.
- [x] Định tuyến hash hai chiều (đọc khi tải, ghi khi đổi `view`, xử lý `popstate`), test.
- [x] `AppRail` với mọi mục menu ở mục 2, huy hiệu số ở Inbox, nhóm Projects liệt kê vài nhóm gần dùng và "All projects".
- [x] Tách `Sidebar.tsx` thành `ChatList` (cột 2), giữ nguyên hành vi: ghim, chọn nhiều, section, tìm kiếm tin nhắn, kéo đổi bề rộng.
- [x] `PageFrame` và `EmptyPage`; `Shell.tsx` chọn nội dung theo `view`.
- **Tiêu chí:** bấm từng mục menu đổi đúng trang, Back/Forward hoạt động, tải lại giữ nguyên trang, chat và nhóm hoạt động như trước.

### 8.2 Đưa các trang có sẵn vào khung
- [x] Dashboard: tổng chi phí/token (chọn khoảng ngày), bảng theo ngày, bot, model; số lượt đang chạy và số thẻ cần duyệt; dùng `/api/usage` hiện có.
- [x] Inbox, Routines, Apps, Input, Skills: dùng lại thành phần hiện có trong `PageFrame`, các hộp thoại cũ vẫn mở được từ nơi khác (nút "Connect apps" trong chat…).
- [x] Agents: bảng bot (tên, engine/model, mức duyệt, thư mục làm việc, đầu vào, lần chạy cuối), nút tạo/nhập/xuất, mở `BotPanel`.
- [x] Projects và All projects: danh sách nhóm bot, tạo nhóm, mở `GroupView`.
- **Tiêu chí:** mọi việc trước đây làm được qua hộp thoại/panel vẫn làm được qua trang; không mất dữ liệu hay hành vi nào.

### 8.3 Trang trống
- [x] Workflows, Bases, Documents dùng `EmptyPage` (không nút, không dữ liệu giả); khai báo `placeholder: true` trong `nav.ts` và có chú thích nhỏ "sắp có".
- **Tiêu chí:** mở được, không lỗi, không gọi API nào.

### 8.4 Hoàn thiện
- [x] Thu gọn AppRail, phản hồi theo bề ngang, ngăn kéo trên màn hình hẹp.
- [x] Phím tắt: `⌘K` tìm kiếm (dùng `CommandPalette`), thêm lệnh nhảy tới từng trang; cập nhật `KeyboardShortcutsModal`. Đã có lệnh "Go to …" cho từng trang trong bảng lệnh `⌘K`; chưa thêm phím tắt chữ riêng cho từng trang.
- [x] Trợ năng: vùng `nav` có nhãn, `aria-current="page"` ở mục đang chọn, thứ tự Tab hợp lý, thông báo khi đổi trang cho trình đọc màn hình.
- [x] i18n: chuỗi mới vào `lib/i18n-vi.ts`, chạy `i18n.test.ts`; cập nhật danh sách cho phép trong `e2e/vi.mjs`.
- [x] Kiểm 13 skin (`scripts/check-skin-contrast.mjs`) với các thành phần mới. Đã chạy, 13 skin đạt.
- [x] Cờ `settings.layout` và mục chọn trong Settings.

### 8.5 Kiểm thử và tài liệu
- [x] Vitest: reducer `view`, định tuyến hash, `nav.ts` (mọi mục có nhãn Việt, mục trống không gọi API).
- [ ] `pnpm test:ui`: các kịch bản so sánh với bản tham chiếu (`reference*.mjs`, `visual.mjs`) giả định bố cục cũ. Cập nhật hoặc tách: giữ chúng chạy với `layout = classic`, thêm bộ ảnh nền mới cho `workspace`. **Một phần:** `scripts/visual.mjs` và `web/e2e/restart.mjs` chạy server với `BOTTEAM_LAYOUT=classic` để giữ bố cục cũ; các kịch bản `reference*.mjs` (so với bản OpenMausBot) chưa chạy lại và không còn là tham chiếu theo `AGENTS.md`.
- [x] Kịch bản e2e: đi qua toàn bộ menu, gửi một tin chat, mở và đóng Apps/Input. Đã có `web/e2e/workspace.mjs` (mọi mục menu, trang trống, Back/Forward, tải lại, thu gọn, ngăn kéo trên điện thoại); chưa có bước gửi tin chat.
- [x] `README.md` (ảnh chụp, mô tả giao diện), `docs/user-guide.md` (hướng dẫn menu), `docs/README.md`; rà `install.ps1` / `install.sh` (không cần đổi) theo `AGENTS.md` số 3.
- **Tiêu chí xong cả phase:** mọi mục menu mở được; trang có sẵn đủ chức năng; trang trống đúng là trống; test web và server xanh; ảnh chụp mới khớp ảnh agenticos về bố cục.

## 5. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| `Sidebar.tsx` lớn, nhiều hành vi (ghim, chọn nhiều, kéo bề rộng, tìm kiếm) dễ mất khi tách | Chuyển nguyên khối sang `ChatList`, chạy test e2e hiện có trước và sau mỗi bước |
| Test so sánh với bản tham chiếu hỏng hàng loạt | Giữ `classic` cho các kịch bản đó; bộ ảnh nền riêng cho `workspace` |
| Hộp thoại nổi (Apps, Usage) có khung riêng, đổi thành trang thì mất ngữ cảnh chat | Vẫn mở được dạng hộp thoại từ nút trong chat; trang chỉ là nơi thứ hai |
| Hash route xung đột với `AuthGate` hoặc liên kết ghép cặp | Đọc hash sau khi đăng nhập; kiểm với trình duyệt ghép cặp (`PairBrowser`) |
| Màn hình hẹp: ba cột chật | Hai ngăn kéo, ưu tiên khung chính; kiểm ở 360, 768, 1024, 1440 px |
| Người dùng quen bố cục cũ | Cờ `classic`, ghi trong "What's new" |

## 6. Ngoài phạm vi

- Làm thật các trang Workflows, Bases, Documents (kho tri thức RAG sẽ là phase riêng).
- Tables, Context, Activity dạng trang, dashboard theo vai trò, nhiều người dùng.
- Ứng dụng desktop, ứng dụng di động gốc, tiện ích nhúng website.

## 7. Câu hỏi cần người dùng trả lời trước khi làm

1. "Projects" ở menu có đúng là **nhóm bot** (channel) không, hay bạn muốn thêm khái niệm project riêng (gom nhiều cuộc trò chuyện)?
2. Mục "Agents" dùng tên **Agents** hay vẫn gọi là **Bot** trên giao diện tiếng Việt?
3. Có giữ cờ `classic` một thời gian để quay lại, hay thay hẳn bố cục cũ?
4. Có muốn thêm Tables, Context, Activity vào menu (ở dạng trang trống) cho giống agenticos, hay đúng như danh sách bạn đưa?

## 8. Kết quả triển khai và chỗ khác kế hoạch

Đã làm: biến `view` và hành động `view`/`rail` trong `store.tsx` (các hành động cũ quy về `view`), `web/lib/nav.ts` (bảng menu, địa chỉ hash), `web/components/layout/` (`AppRail`, `PageFrame`, `EmptyPage`, `pages.tsx`, `useHashRoute`, `useWorkspace`), `Shell.tsx` chọn bố cục, `Sidebar` nhận `workspace` để làm cột "Chats", `Observe`/`ConnectedApps`/`NotificationsPanel` nhận `embedded` để dùng làm trang, cài đặt `layout` (server và Settings), lệnh "Go to …" trong `⌘K`, i18n, test Vitest (`lib/nav.test.ts`), test server (`test_phase3.py`) và `web/e2e/workspace.mjs`.

Quyết định mặc định cho bốn câu hỏi ở mục 7 (đổi được sau): (1) Projects là nhóm bot hiện có; (2) nhãn "Agents", bản Việt là "Bot"; (3) giữ `classic`; (4) không thêm Tables, Context, Activity.

Khác kế hoạch: địa chỉ là `#/<trang>[/<id>]` (ví dụ `#/agents`, `#/chat/<bot>`) chứ không có tiền tố `build/`; các hộp thoại cũ (Usage, Apps, Inbox) trả về `null` trong bố cục workspace và các thành phần đó chạy ở chế độ `embedded` làm trang, nên không viết hai lần; `BOTTEAM_LAYOUT=classic` đặt bố cục mặc định cho môi trường kiểm thử; Routines vẫn dùng `AutomationsPage` nguyên bản (tiêu đề "Automations", có nút quay lại).

Chưa làm: ảnh "trước" của các màn hình, chạy lại các kịch bản `reference*.mjs`, phím tắt chữ riêng cho từng trang, bước gửi tin chat trong `workspace.mjs`, ảnh chụp mới trong README.
