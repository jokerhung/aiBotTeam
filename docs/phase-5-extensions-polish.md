# Phase 5 — Mở rộng, hoàn thiện, đóng gói

**Mục tiêu:** bot có "tay" (MCP server, app kết nối, trình duyệt), có trí nhớ và kỹ năng; công cụ quan sát; chia sẻ đội; đa ngôn ngữ; đóng gói chạy một lệnh.

**Tham chiếu:** `docs/custom-mcp-servers.md`, `docs/composio.md`, `docs/memory.md`, `docs/team-sharing.md`, `docs/presets.md`, `docs/localization.md`, `docs/mcp-server.md`, `docs/headless-cli.md`, `docs/self-hosting.md`; `server/routes/mcp-servers.ts`, `server/browser/`, `server/usage-trace/`, `shared/package-format.ts`, `shared/skill-md.ts`; `src/components/PluginsPanel.tsx`, `McpServersPanel.tsx`, `McpServerEditor.tsx`, `ConnectorCard.tsx`, `ComputerPanel.tsx`, `BrowserPanel.tsx`, `browser/StreamSurface.tsx`, `InspectorPanel.tsx`, `ActivityPanel.tsx`, `usage/`, `bot-settings/MemorySection.tsx`, `SkillsSection.tsx`, `ShareTeamDialog.tsx`, `TeamLibraryPanel.tsx`, `onboarding/`, `src/locales/`. Ảnh: `marketplace.png`, `computer-panel.png`, `docs-onboarding.png`.

## 1. Plugins: MCP server tuỳ chỉnh

- [ ] `McpServerSpec`: stdio (`command`, `args`, `env`) hoặc từ xa (`http` / `sse`, `url`, `headers`). Giá trị header là bí mật: không đưa lên argv, không trả về UI.
- [ ] Route: `GET/POST /api/mcp/servers`, `PATCH/DELETE /api/mcp/servers/{id}`, kiểm kết nối + liệt kê công cụ; frame `mcp.changed`.
- [ ] Chọn server theo bot (`mcpServers`), gắn vào lượt qua `integrations.custom`; driver bỏ qua loại nó không nói được.
- [ ] Không tự cho phép trước: mọi lời gọi công cụ đi qua permission broker theo mức duyệt của bot.
- [ ] Cắt kết quả công cụ quá dài theo ngân sách ký tự mỗi server, lưu bản đầy đủ ra file.
- [ ] UI `McpServersPanel` + `McpServerEditor`: danh sách, trạng thái kết nối, dán JSON cấu hình kiểu Claude Desktop để nhập nhanh.

## 2. Connected apps

Theo `PluginsPanel.tsx` và `marketplace.png`:

- [ ] Modal "Connected apps": tiêu đề + nút làm mới + ✕, dải cảnh báo màu warning khi chưa có khoá, ô "Search apps", danh sách hàng (logo 44px, tên, mô tả một dòng, nút `Connect`).
- [ ] Tích hợp Composio qua khoá dự án của người dùng: danh mục, `authorize` (OAuth mở tab mới), trạng thái đã nối; cầu MCP stdio do harness sở hữu để yêu cầu kết nối thành thẻ tin cậy trong chat (`ConnectorCard`).
- [ ] Phạm vi theo bot: mỗi app `read` / `write`; hành động gửi ra ngoài theo chính sách `ask` / `allow`.
- [ ] Nếu không dùng Composio: giữ nguyên UI, nguồn danh mục là các MCP server từ xa có OAuth — quyết định ở đầu phase.

## 3. Computer panel (mức trình duyệt)

Theo `ComputerPanel.tsx` và `computer-panel.png`. Máy đám mây, Local VM và điều khiển máy thật nằm ngoài phạm vi; phase này làm "nơi chạy = trình duyệt tích hợp".

- [ ] Panel phải: header (bánh răng · "Computer" · ✕), nhãn "{Bot}'s screen", khung xem trước sống, nút `Open desktop` / `Sleep`, thẻ "Runs on" với nhóm chọn phân đoạn, thẻ "Routines" của bot.
- [ ] Backend: Playwright (Python) — mỗi bot một context bền; MCP server "browser" cung cấp điều hướng, bấm, gõ, chụp.
- [ ] Phát khung hình qua frame `screen` (png/jpeg, có giới hạn tần suất); ảnh chụp công việc gập vào transcript (tin `screen`).
- [ ] Người dùng giành quyền điều khiển (`computer-control`: held, helpReason); bot xin trợ giúp khi gặp đăng nhập/CAPTCHA — người tự làm, bot không vượt.
- [ ] Mọi hành động trình duyệt có tác dụng phụ đi qua permission broker.

## 4. Quan sát

- [ ] **InspectorPanel:** dòng thời gian `RuntimeEvent` của thread từ log NDJSON, xem `raw`, lọc theo loại.
- [ ] **ActivityPanel:** các lần chạy gần đây của bot, thời lượng, tool đã dùng.
- [ ] **Usage:** token và chi phí theo bot/model/ngày (`/api/usage`), đồng hồ ngữ cảnh ở composer (`contextTokens` / `contextWindow`), giờ đặt lại hạn mức.
- [ ] Biểu đồ thác thời gian của một lượt (`TraceWaterfall`).
- [ ] Xuất transcript (Markdown / JSON).

## 5. Trí nhớ và kỹ năng

- [ ] **Memory:** ghi chú bền theo bot (file Markdown trong thư mục bot), khối "recall" harness đặt trước tin của lượt; bật/tắt theo bot; UI xem/sửa/xoá từng ghi chú (`MemorySection`).
- [ ] Bộ nhớ đội dùng chung theo section, sửa đổi qua thẻ duyệt.
- [ ] **Skills:** thư viện `SKILL.md` (frontmatter + hướng dẫn), gán cho bot, bật/tắt; với Claude CLI gắn qua thư mục skills của lượt.
- [ ] Nén ngữ cảnh: đánh dấu `context.compacted` trong chat.

## 6. Chia sẻ và nhập đội

- [ ] Định dạng gói: một file Markdown có YAML frontmatter (bot, chỉ dẫn, avatar, phòng, routine, chỗ trống kết nối).
- [ ] Xuất (`ShareTeamDialog`): hiện chính xác file chứa gì; **không bao giờ** kèm lịch sử chat, khoá, lựa chọn model, máy tính; lọc mọi chuỗi giống bí mật.
- [ ] Nhập: màn duyệt trước khi tạo; bot mới ở mức `ask`, skill tắt, routine tạm dừng, kết nối tắt cho đến khi duyệt.
- [ ] Route `POST /api/teams/export`, `POST /api/teams/import` (từ file hoặc URL GitHub công khai, có giới hạn kích thước và chặn địa chỉ nội bộ).
- [ ] Bot mẫu (preset) cho hộp thoại tạo bot.

## 7. Đa ngôn ngữ và trợ năng

- [ ] `lib/i18n.ts` với hàm `t()`; chép khoá tiếng Anh từ `src/locales/`, thêm **tiếng Việt**; kiểm thiếu khoá trong CI.
- [ ] Văn bản cố định từ server gửi dạng mã + tham số (`ServerText`), client dịch.
- [ ] Hướng chữ theo từng dòng cho nội dung chat (`unicode-bidi: plaintext`).
- [ ] Trợ năng: mọi cặp chữ/nền đạt WCAG AA (chép `scripts/check-skin-contrast.mjs`), điều hướng bàn phím đủ cho menu/dialog, `aria-live` đọc tin mới (`TranscriptAnnouncer`), tôn trọng `prefers-reduced-motion` và `forced-colors`.
- [ ] Biến thể `touch:` cho mọi nút chỉ hiện khi hover.

## 8. Lần đầu sử dụng

- [ ] Màn chào: dò engine, hướng dẫn cài/đăng nhập CLI (`EngineSetup`), tạo bot đầu tiên.
- [ ] Bot mới tự chào và hỏi "What do you mostly want help with?" bằng thẻ câu hỏi.
- [ ] Spotlight giới thiệu model picker, panel máy tính, automations (`onboarding/Spotlight`).
- [ ] Mục "What's new".

## 9. Điều khiển từ ngoài và đóng gói

- [ ] **MCP server của app** (stdio) cho Claude Desktop/Cursor: xem bot và phòng, đọc/tìm transcript, tạo bot/phòng/task, gửi việc, chờ xong, đổi model, ngắt lượt. Không lộ: cấp duyệt, xoá, cài đặt, bí mật.
- [ ] **CLI không màn hình:** `botteam team apply team.yaml`, `botteam run "<bot>" "<việc>" --export ./out`, `--json`, mã thoát có nghĩa.
- [ ] **Chạy một lệnh:** `botteam` khởi động API và phục vụ bản build tĩnh của web (hoặc `next start` cạnh uvicorn); tuỳ chọn `--no-open`.
- [ ] **Docker / compose:** một image, volume cho `~/.botteam`.
- [ ] **Truy cập từ xa (tuỳ chọn):** khi không nghe loopback thì bắt buộc đăng nhập bằng mã ghép nối + cookie phiên; mặc định vẫn chỉ `127.0.0.1`.
- [ ] Sao lưu/khôi phục thư mục dữ liệu.

## 10. Kiểm thử và nghiệm thu cuối

- [ ] So ảnh toàn bộ danh mục màn hình của 5 phase trên 13 skin × 2 kích thước; báo cáo màn lệch.
- [ ] Hiệu năng: transcript 5.000 tin cuộn mượt; 10 bot stream đồng thời không rớt frame SSE; thời gian tới lần vẽ đầu < 1,5 giây ở localhost.
- [ ] Bền bỉ: tắt đột ngột server trong lúc ghi → SQLite không hỏng, không mất tin đã xác nhận.
- [ ] Rà bảo mật: tiêm chỉ thị qua kết quả tool/trang web không tự cấp quyền; bí mật không vào log, SSE hay file xuất; SSRF ở nhập đội và MCP từ xa; đường dẫn file không thoát kho.
- [ ] E2E Playwright cho 6 hành trình chính: tạo bot → chat → duyệt lệnh → giao việc trong phòng → routine chạy → nhập một đội.
- [ ] Tài liệu người dùng: cài đặt, bot đầu tiên, cấu hình engine, tự host.

## Tiêu chí hoàn thành

1. Thêm một MCP server stdio trong UI → bot gọi được công cụ của nó sau khi được duyệt.
2. Nối một app (ví dụ GitHub) → bot đọc được dữ liệu qua app đó; hành động ghi hỏi trước.
3. Bot mở trang web trong trình duyệt tích hợp, panel Computer hiện màn hình sống, người dùng giành và trả quyền điều khiển được.
4. Inspector hiện đủ chuỗi sự kiện của một lượt; trang Usage khớp tổng token của các lượt.
5. Xuất một section thành file, nhập vào thư mục dữ liệu trống → đội dựng lại đúng, không có bí mật hay lịch sử trong file.
6. Chuyển giao diện sang tiếng Việt không còn chuỗi tiếng Anh sót ở các màn chính.
7. `docker compose up` trên máy sạch → dùng được trong ≤ 2 phút.
8. Toàn bộ so ảnh, E2E và rà bảo mật ở mục 10 đạt.

## Cập nhật sau đối chiếu (2026-11-10)

- **Thêm hạng mục: chế độ Advanced** (công tắc `omb-advanced-mode`): sidebar có Search/Automations/Plugins/hàng người dùng, header `+ Task` + `ModelPicker` hai cột + icon gọi, `BotSettingsDialog`, khiên duyệt ở composer, chọn skin/phông/độ rộng chat, các chip theo dõi (`ActivityRun`). Ảnh README là mốc đối chiếu của chế độ này.
- **Connected apps** mở từ viên thuốc "Connect apps" ở chân sidebar (`PluginsPanel`), cả Simple lẫn Advanced.
- **Onboarding thật:** `WelcomeGate`, `MausBotWelcome`, `GuidedTour`, `FirstConversationTour` (thay cho mô tả chung ở mục 8).
- **13 skin:** `system` mặc định; bộ chọn skin chỉ ở Advanced.
