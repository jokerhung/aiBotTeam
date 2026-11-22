# Phase 9 — Trang Agents (danh sách, thêm, sửa) theo agenticos

**Mục tiêu:** làm lại trang **Build → Agents** (`#/agents`) giống trang `/agents` của agenticos, gồm ba màn hình: **danh sách** các agent dạng thẻ, hộp thoại **thêm** agent mới, và **trang sửa** một agent có các tab. Trong BotTeam "agent" là một bot (trên giao diện gọi là **Agent**, kể cả tiếng Việt); dữ liệu và API của bot giữ nguyên. Phase này đổi giao diện, gom các phần sửa đang rải rác (hộp thoại New bot, panel Bot settings) về một chỗ, và thêm **thư viện Agent templates** chuyển từ agenticos.

**Trạng thái:** kế hoạch, chưa có mã. Đã chốt năm quyết định của người dùng (mục 8): gọi là **Agent** như agenticos, có nút **Save**, **Agent templates là thư viện mẫu chuyển từ agenticos**, bấm Settings trong panel chat chuyển sang trang sửa đầy đủ, Evals và Knowledge gaps là trang trống.

**Nguồn tham chiếu.** Ứng dụng tham chiếu `http://100.79.177.78:3000/agents` (agenticos 1.89.1) đã được đăng nhập và đối chiếu bằng mắt (danh sách, hộp thoại New agent, trang sửa và cả tám tab); ghi chú chi tiết ở `docs/verification/agents-reference.md`. Mã nguồn công khai của agenticos dùng để hiểu hành vi:

- Danh sách: `frontend/src/app/[locale]/(dashboard)/agents/page.tsx`, `components/agents/agent-card.tsx`.
- Thêm: `components/agents/create-agent-dialog.tsx`.
- Sửa: `app/[locale]/(dashboard)/agents/[id]/page.tsx`, `instructions-editor.tsx`, `model-profile-picker.tsx`, `build-section.tsx`.

## 1. Hiện trạng trong BotTeam

- `AgentsPage` (`web/components/layout/pages.tsx`) là bảng đơn giản: avatar, tên, model, mức duyệt, thư mục, nút sửa; hai nút `Import bot`, `New bot`.
- **Thêm:** `NewBotDialog.tsx` (vai mẫu, tên, title, model, mô tả, instructions, màu, mức duyệt, thư mục).
- **Sửa:** `BotPanel.tsx` → `SettingsForm` (một cột dài: tên, title, mô tả, instructions, model, model dự phòng, mức duyệt, thư mục, thông báo, báo cáo cho ai, ứng dụng, kênh đầu vào, intake, kỹ năng, bộ nhớ, Chief of Staff) mở ở panel phải của chat.
- Thao tác khác nằm ở `BotContextMenu.tsx`: nhân bản (`POST /api/bots/{id}/duplicate`), ẩn, xóa có hoàn tác; xuất/nhập bot ở `BotFile.tsx`.
- Server đã có đủ API (`POST /api/bots`, `PATCH /api/bots/{id}`, `DELETE`, `duplicate`, `export-file`); bot lưu dạng JSON nên thêm trường mới không cần đổi lược đồ.

## 2. Giao diện đích (đã đối chiếu với ứng dụng thật)

### 2.1 Danh sách (`#/agents`)

- **Đầu trang:** chữ "Agents" lớn kèm biểu tượng thông tin `(i)`; bên phải hai nút: **Agent templates** (viền, nền nhạt; mở thư viện mẫu ở mục 2.4) và **New agent** (nút chính màu tối, dấu `+`).
- **Hàng điều khiển** nằm ngay dưới tiêu đề, không nằm trong khung thẻ: ô **Search agents** (có kính lúp), danh sách chọn trạng thái có biểu tượng lọc (**All, Published, Drafts, Archived**), thêm bộ lọc nhãn khi có; **dòng đếm ở mép phải** ("2 agents", khi có lọc "N of M").
- **Lưới thẻ** thẳng trên nền trang (không có khung "Catalog" bao ngoài): 3 cột ở 1500 px (mỗi thẻ ~390 px), 2 cột ở cỡ vừa, 1 cột trên điện thoại. Thẻ bo góc lớn, viền mảnh, nền sáng.
- **Một thẻ:** linh vật tròn màu cỡ lớn; tên (đậm, tối đa hai dòng); dưới tên là chip "ai dùng được" có biểu tượng nhỏ (ví dụ "Organization"); mô tả cắt ở **ba dòng**; một đường kẻ ngang; huy hiệu trạng thái là **chấm màu + chữ thường** ("draft"); chân thẻ: "edited <ngày>" bên trái, **bút chì** và **`…`** bên phải.
- **Menu `…`:** Duplicate, Archive hoặc Restore, Delete permanently (mỗi mục có một dòng mô tả); Archive hỏi xác nhận, Delete bắt gõ tên.
- **Trạng thái đặc biệt:** khung xương cùng bố cục khi tải, lỗi có nút Retry, rỗng (biểu tượng, câu giải thích, nút New agent), không khớp bộ lọc (nút Clear filters).
- Cả thẻ là một liên kết mở trang sửa; bút chì và `…` nằm ngoài vùng liên kết.

### 2.2 Thêm (hộp thoại New agent)

Hộp thoại rộng ~670 px, nền trắng, bo lớn, nút đóng `×`:

- **Tiêu đề** "New agent", dòng phụ "It starts as a draft. Nothing runs until you publish it."
- Chỉ hai khối **luôn hiện**: **Name** (ô gợi ý "Support Copilot", dòng nhỏ giải thích mã `@your-agent`) và **Who can find it** (ba thẻ chọn cạnh nhau: Everyone, Only me, Some people, mỗi thẻ một câu mô tả).
- **More options** (gập): Description (ô nhiều dòng), Categories và Tags (hai ô thêm nhãn cạnh nhau).
- **Chân hộp thoại:** bên trái dòng nhỏ "Starts with 20 recommended tools", bên phải **Cancel** và **Create** (xám khi chưa có tên).
- Create tạo agent rồi mở trang sửa.

**Cho BotTeam:** giữ đúng khung và độ gọn, đổi nội dung cho hợp:
- Luôn hiện: **Name** (dòng nhỏ thay mã `@handle`) và **Starting role** thành ba đến bốn thẻ chọn cạnh nhau (các vai mẫu hiện có, thay chỗ "Who can find it").
- **More options:** Description, Title, **Section** (thay Categories/Tags), Model, Approval level, Working folder, Mascot color, Instructions.
- Chân: "Starts at <mức duyệt>" (như hộp thoại cũ) thay dòng "recommended tools".

### 2.3 Sửa (`#/agents/<id>`)

- **Đầu trang:** đường dẫn `Agents > <tên>`; hàng dưới là linh vật tròn lớn (bấm để đổi), **tên rất lớn** kèm biểu tượng `(i)`, và dưới tên chip trạng thái ("draft"). Bên phải: **Test**, **Open in chat**, nút `…` (More page actions) và nút chính **Publish**.
- **Tám tab** có biểu tượng, gạch chân tab đang chọn: **Build, Toolbox, MCP servers, Limits, Availability, Evals, Knowledge gaps, History**.
- **Build:** thẻ **Instructions** (tiêu đề, `(i)`, nút **Preview** và nút phóng to; ô soạn lớn, biến dạng `{{agent_name}}` được tô màu); thẻ **Model** (tóm tắt "Organization default" cạnh tiêu đề; **Provider** và **Model** là hai ô chọn cạnh nhau; liên kết "Name it something else", nút **Add model**); các dòng gập **Model access** và **Model settings**; còn nhiều khối gập khác bên dưới.
- **Toolbox:** thẻ **Capabilities** có ô tìm kiếm; các nhóm có tên và đếm ("Work with data — 4 of 10 on", "Chat channels — 0 of 1 on") là **hàng thẻ cuộn ngang**, mỗi thẻ có hình minh họa, nhãn "Recommended", tên, mô tả, số công cụ và **công tắc bật/tắt**.
- **MCP servers:** nút **Connect a server**, ô tìm kiếm, hai hộp lọc (Organization connections, Connected to this agent), lưới thẻ máy chủ (logo, tên, mô tả, trạng thái "Not connected" hoặc "Asks before consequential actions", **công tắc**).
- **Limits:** thẻ **Run limits** (Monthly USD, Max steps per run, công tắc Stop tool-call loops kèm hai ô số, công tắc Code mode); ba dòng gập bên dưới: Run reviewers, Alerts, Tracing.
- **Availability:** thẻ **Where people reach this agent** (bốn ô: Website widget, Hosted page, Raw WebSocket, Public API) và thẻ **Chat apps** (lưới ô "Connect a bot": Slack, Microsoft Teams, Telegram, Mattermost, SMS, Email, iMessage, Discord, Matrix).
- **History:** thẻ **Versions** ("Never published") và **Improvement history** ("No improvement sessions yet").
- Tab ghi vào địa chỉ: `#/agents/<id>/<tab>`.

**Cho BotTeam** (cùng khung, nội dung của BotTeam):

| Tab | Nội dung trong BotTeam |
|---|---|
| Build | **Instructions** (`soul`; nút Preview Markdown và phóng to), **Model** (engine + model + mức suy luận, tóm tắt một dòng), **Backup model**, **Basics** (Title, Description, màu linh vật, Section) |
| Toolbox | Thẻ **Capabilities** dạng hàng thẻ có công tắc: **Memory** (bật/tắt bộ nhớ), **Skills** (mỗi kỹ năng là một thẻ có công tắc, nút tạo mới), **Connected apps** (ứng dụng Composio đã cấp) |
| MCP servers | Lưới các máy chủ MCP của người dùng với công tắc cấp cho bot, quyền đọc/ghi, công cụ cho phép; nút **Connect a server** mở trang Apps |
| Limits | **Access** (Ask, Edits, Auto, Full dạng thẻ chọn), **Working folder**, **Reports to**, **Chief of Staff** và nhóm nó quản lý, **Notifications**; ô Monthly (USD) và Max steps chưa có nên để trống đến khi có ngân sách |
| Availability | Thẻ **Where people reach this agent**: Telegram, Zalo, Zalo cá nhân (kênh nhận tin), **intake.md**, webhook; ô Website widget, Raw WebSocket, Public API đánh dấu "Soon". Thẻ **Chat apps** liệt kê Telegram, Zalo và Zalo cá nhân với nút **Connect a bot** |
| Evals, Knowledge gaps | Chưa có: tab hiện nhưng là trang trống "Nothing here yet" (cùng cách với Workflows trong menu) |
| History | **Conversations** (các tác vụ và lượt chạy của bot, chi phí) thay cho Versions; **Improvement history** trống |

- Đầu trang BotTeam: nút chính **Save** (ở vị trí của Publish; mờ khi chưa có thay đổi), **Discard** khi có thay đổi, **Open in chat**, `…` (Export bot file, Duplicate, Change mascot color, Archive/Restore, Delete). Không có Test (không có bản nháp để thử) và không có Publish; chip trạng thái là **active** hoặc **archived**.
- **Lưu bằng nút Save (đã chốt):** mọi thay đổi trong trang sửa chỉ giữ trong biểu mẫu cho đến khi bấm **Save** (hoặc `Ctrl/⌘ S`); cạnh tên có chip "Unsaved changes" / "Saved" / lỗi; **Discard** trả về giá trị đã lưu; rời trang hoặc đổi sang agent khác khi còn thay đổi thì hỏi xác nhận. Các thứ có API riêng (gán kênh đầu vào, tệp `intake.md`, lịch chạy, ghi chú, tạo/sửa kỹ năng và máy chủ MCP) vẫn lưu tại chỗ bằng nút riêng của chúng; chỉ các trường của chính agent (tên, title, mô tả, instructions, model, model dự phòng, mức duyệt, thư mục, thông báo, báo cáo cho ai, Chief, nhóm, màu, kỹ năng và máy chủ MCP được gán, bộ nhớ) đi qua Save.
- Nếu agent đổi từ nơi khác trong lúc đang sửa (ví dụ trong chat), hiện thông báo "This agent changed elsewhere" với nút **Reload** và **Keep mine**.

### 2.4 Agent templates (thư viện mẫu)

Theo `agent-template-dialog.tsx` và `backend/app/core/catalog/agent_templates` của agenticos (28 mẫu theo 7 ngành, mỗi mẫu một tệp `AGENT.md` gồm phần đầu YAML và phần thân là instructions; giấy phép Apache-2.0):

- Nút **Agent templates** mở hộp thoại thư viện: màn đầu là **lưới ngành** (mỗi ngành một biểu tượng: Healthcare, Finance, E-commerce, Software, Public sector, Legal, Manufacturing, và **General** gồm các vai mẫu BotTeam đang có), ô tìm kiếm; bấm một ngành thì sang danh sách mẫu của ngành đó (nút quay lại), mỗi mẫu có tên, mô tả, nút **Use template**.
- **Use template** tạo một agent mới từ mẫu (tên, mô tả, instructions, mức duyệt Ask) rồi **mở thẳng trang sửa** để chọn model và thư mục làm việc, giống agenticos (agent mới cần thêm model nên không dừng ở danh sách).
- Nội dung mẫu giữ nguyên tiếng Anh (agent trả lời theo ngôn ngữ người dùng); tên ngành và nhãn giao diện có bản Việt.

## 3. Ánh xạ agenticos → BotTeam

| agenticos | BotTeam | Cách xử lý |
|---|---|---|
| Trạng thái Published / Draft / Archived (chấm màu + chữ) | `hidden` (ẩn) | Lọc: **All, Active, Archived** (bỏ Published/Drafts); Archive = `hidden: true`, Restore = `hidden: false`; chip **active** hoặc **archived**. Không làm Draft/Publish. |
| Chip "ai dùng được" (Organization, Private, Shared) và thẻ "Who can find it" | Nhóm (section) của bot; vai mẫu | Chip trên thẻ hiện tên nhóm; trong hộp thoại thêm, ba thẻ chọn là các vai mẫu. Không có chia sẻ theo người dùng. |
| Categories, tags | Nhóm (section) | Bộ lọc theo nhóm thay cho hai bộ lọc nhãn. |
| Avatar tải lên, 12 màu | Linh vật + màu | Giữ linh vật, chọn màu ở menu hoặc tab Build. |
| Handle `@slug` | Tên bot | Chỉ hiện gợi ý trong hộp thoại; BotTeam không dùng slug. |
| Publish (bản nháp rồi xuất bản) | **Save** | Lưu ngay vào agent; không có phiên bản. |
| Edited <ngày> | không có | Thêm `updatedAt` và `createdAt` vào bot (mục 4). |
| Model profile + cài đặt model | `modelSelection` (instance, model, effort) + `fallbackSelection` | Dùng lại `ModelPicker`. |
| Knowledge, Context, Sandbox, Guardrails, Budget | `memory`, `skills`, `mcpServers`, mức duyệt | Đưa các phần có sẵn vào đúng tab; phần chưa có để trống. |
| Evals, Knowledge gaps (tab); Judge datasets, Publish history | không có | Hai tab là trang trống; phần còn lại bỏ (mục 7). |
| Export YAML | Export bot file | `POST /api/bots/{id}/export-file`. |
| Agent templates (thư viện theo ngành) | `presets` + mẫu chuyển từ agenticos | **Chuyển 28 mẫu** (mục 4); các vai mẫu BotTeam đang có thành ngành General. Cột YAML `capabilities`, `skills`, `mcp`, `attach`, `budget_usd` của agenticos không có tương đương nên chỉ giữ tên, mô tả và instructions (cột `mcp` và `skills` ghi thành gợi ý trong phần mô tả nếu có). |

## 4. Thiết kế kỹ thuật

- **Định tuyến:** thêm view `agent` vào `web/lib/nav.ts` (`#/agents/<id>[/<tab>]`; `agents` vẫn là danh sách); `useHashRoute` ghi và đọc id và tab; nhập sai id quay về danh sách. Reducer: hành động `openAgent {id, tab?}` và trường `selectedAgentId`, `agentTab`.
- **Thành phần mới** trong `web/components/agents/`: `AgentsPage` (danh sách), `AgentCard`, `AgentFilters`, `AgentFormDialog` (thêm), `AgentEditor` (trang sửa), `tabs/Build.tsx`, `Toolbox.tsx`, `Mcp.tsx`, `Limits.tsx`, `Availability.tsx`, `History.tsx`, `InstructionsEditor`, `BuildSection` (khối gập có tóm tắt), `ConfirmDelete` (gõ tên để xác nhận).
- **Dùng lại, không viết lại:** `ModelPicker`, `ApprovalModeSelector`, `SkillsSection`, `MemorySection`, `AppsField`, `McpServers`, `BotInputs`, `IntakeSection`, `Routines`, `ExportButtons`, `ActivityPanel` hiện nằm trong `BotPanel.tsx` và vài file khác: xuất (export) các phần đó và đặt vào tab; `BotPanel` giữ lại cho chat (Overview, Activity, Inspector) và trỏ "Edit profile" về trang mới.
- **Lưu:** dùng `queuePatch` và `useSaved` hiện có; thêm chỉ báo lưu chung ở đầu trang.
- **Server (nhỏ):** thêm `createdAt`, `updatedAt` vào `WireBot`, đặt khi tạo và khi `PATCH` (thêm test); thêm bộ lọc `hidden` vào danh sách đã có (client lọc được, không cần endpoint mới).
- **Hộp thoại New bot** hiện có thay bằng `AgentFormDialog`; `NewBotDialog.tsx` xóa sau khi mọi chỗ gọi đã chuyển.
- **Giao diện:** dùng token màu của skin hiện có; thẻ cao đều, bo `rounded-xl`, đường viền mảnh, linh vật cỡ lớn, huy hiệu nhỏ; khung xương khi tải; chạy được ở 360, 768, 1024, 1440 px.
- **i18n:** chuỗi mới vào `lib/i18n-vi.ts`; theo quyết định, "Agents" **không** dịch thành "Bot" nữa (đổi mục "Agents" hiện đang dịch là "Bot" trong từ điển), chạy `i18n.test.ts`.

### Bổ sung kỹ thuật cho các quyết định đã chốt

- **Biểu mẫu có Save:** `AgentEditor` giữ một `draft` (bản sao các trường của agent) và `dirty = draft ≠ agent`; Save gửi một `PATCH /api/bots/{id}` chỉ gồm các trường đã đổi; sau khi lưu nhận bot mới qua SSE như hiện nay. Các thành phần dùng lại (`SkillsSection`, `MemorySection`, `AppsField`, `ApprovalModeSelector`, `ModelPicker`) hiện gọi `queuePatch` thẳng: đổi thành thành phần có `value`/`onChange` (điều khiển được), để dùng trong biểu mẫu; panel chat không còn dùng chúng.
- **Panel chat:** nút Settings và "Edit Profile" (hàng bot, menu hồ sơ, `BotPanel`) đều `dispatch({ type: "openAgent", id, tab: "build" })`; `SettingsForm` bị xóa khỏi `BotPanel`, panel chỉ còn Overview, Activity, Inspector.
- **Thư viện mẫu:**
  - Script một lần `scripts/import-agenticos-templates.mjs` tải `AGENT.md` của 28 mẫu (bỏ `general/agenticos` và `general/platform-assistant` vì gắn với nền tảng agenticos) và ghi `server/botteam/templates/<ngành>/<id>.md` (phần đầu YAML còn `name`, `description`, `industry`; phần thân là instructions). Các tệp mẫu được commit.
  - Server: `GET /api/templates` (ngành, mẫu, gồm cả vai mẫu BotTeam), `POST /api/templates/{id}/install` (tạo bot từ mẫu, trả id), có test; mẫu được đọc lúc khởi động, không gọi mạng.
  - **Giấy phép:** agenticos là Apache-2.0; thêm mục vào `NOTICE` (nguồn, giấy phép, "đã chỉnh sửa: bỏ các trường cấu hình") và giữ dòng nguồn trong từng tệp mẫu.
  - Web: `TemplateLibraryDialog` (lưới ngành, danh sách mẫu, tìm kiếm).
- **Từ ngữ:** mọi nhãn "Bot" ở các màn hình Agent đổi thành "Agent" (New agent, Import agent, Edit agent…); `i18n-vi.ts` dịch "Agents" là **Agent** (không dịch sang "Bot").

## 5. Các bước

### 9.0 Chuẩn bị
- [x] Đăng nhập ứng dụng tham chiếu (v1.89.1), xem danh sách, hộp thoại thêm và cả tám tab của trang sửa; ghi chú ở `docs/verification/agents-reference.md`.
- [x] Đo kích thước cụ thể (cỡ chữ, khoảng cách, màu) khi bắt đầu làm từng màn hình và ghi vào `docs/verification/agents-tokens.md`.
- [x] Chốt các câu hỏi: người dùng đã trả lời cả năm (mục 8).

### 9.1 Danh sách
- [x] Server: `createdAt`, `updatedAt` của bot (+ test, bot cũ không có thì để trống).
- [x] `AgentsPage` mới: tiêu đề kèm `(i)`, nút Agent templates và New agent, hàng điều khiển (tìm kiếm, lọc trạng thái và nhóm, đếm ở mép phải), lưới 1/2/3 cột không có khung bao, khung xương, trạng thái lỗi/rỗng/không khớp.
- [x] `AgentCard` và menu `…` (Duplicate, Archive/Restore, Delete có gõ tên), toast hoàn tác khi xóa như hiện nay.
- **Tiêu chí:** mọi việc làm được ở bảng cũ vẫn làm được; tìm kiếm và lọc đúng; lưới đổi cột theo bề ngang; không còn mục nào chỉ có ở menu chuột phải mà thiếu ở thẻ.

### 9.2 Thêm
- [x] `AgentFormDialog` gọn như mục 2.2 (Name, Starting role dạng thẻ chọn, More options gập, chân hộp thoại Cancel/Create), kiểm tra tên (rỗng, quá dài), lỗi hiện dưới ô.
- [x] Tạo xong mở trang sửa; mọi nơi gọi "New bot" (menu, danh sách Chat, `⌘N`, lệnh trong `⌘K`) dùng hộp thoại mới.
- **Tiêu chí:** tạo bot chỉ với tên; bot mới có thư mục làm việc mặc định như bây giờ; mở được trang sửa ngay.

### 9.3 Sửa
- [x] Route `#/agents/<id>/<tab>`, `AgentEditor` với đầu trang và tab; biểu mẫu `draft` với nút **Save**, **Discard**, chip Unsaved/Saved, `Ctrl/⌘ S`, hỏi xác nhận khi rời trang chưa lưu, thông báo "changed elsewhere".
- [x] Tab Build (Instructions có Preview, Model, Backup model, Basics) và Limits trước; sau đó Toolbox (hàng thẻ có công tắc), MCP servers (lưới thẻ có công tắc), Availability (ô kênh và Chat apps), History bằng cách đưa thành phần có sẵn vào; Evals và Knowledge gaps là trang trống.
- [x] Đầu trang (đường dẫn, linh vật, tên lớn kèm `(i)`, chip trạng thái, Open in chat) và menu `…`: Export, Duplicate, màu, Archive/Restore, Delete.
- [x] Chuyển các thành phần dùng lại sang dạng điều khiển được (`value`/`onChange`); nút Settings và Edit Profile ở panel chat, hàng bot và menu hồ sơ mở trang sửa; xóa `SettingsForm` khỏi `BotPanel`.
- [x] Evals và Knowledge gaps: hai tab trang trống "Nothing here yet".
- **Tiêu chí:** mọi trường của `SettingsForm` cũ sửa được ở trang mới, lưu thật (kiểm bằng tải lại); đổi tab giữ nguyên chỗ đã sửa chưa lưu; id sai quay về danh sách.

### 9.4 Agent templates
- [x] Script `scripts/import-agenticos-templates.mjs`; commit 28 tệp mẫu trong `server/botteam/templates/`; mục `NOTICE` cho Apache-2.0.
- [x] Server: `GET /api/templates`, `POST /api/templates/{id}/install` (+ test: đủ ngành, cài một mẫu tạo đúng bot ở mức Ask, id lạ trả 404).
- [x] `TemplateLibraryDialog`: lưới ngành có biểu tượng, danh sách mẫu, tìm kiếm, nút Use template; nối vào nút **Agent templates**; cài xong mở trang sửa.
- **Tiêu chí:** cài từng ngành một mẫu, bot mới có tên, mô tả, instructions đúng và mở được ở trang sửa; không có yêu cầu mạng khi mở thư viện.

### 9.5 Hoàn thiện
- [x] Màn hình hẹp (tab cuộn ngang, hộp thoại không tràn), bàn phím và trợ năng (thẻ có nhãn "Open <tên>", menu có nhãn, thứ tự Tab), i18n tiếng Việt.
- [x] Phím tắt: `G A` đã có; thêm `N` ở danh sách để mở New agent.
- [x] Cập nhật ảnh trong README, `docs/user-guide.md`, `docs/README.md` (rà `install.ps1` và `install.sh`, dự kiến không đổi).

### 9.6 Kiểm thử
- Vitest: lọc/tìm kiếm danh sách, hash route có id và tab, suy mã `@handle`, reducer `openAgent`, logic `dirty`/Save/Discard của biểu mẫu, tìm kiếm mẫu.
- pytest: `createdAt`/`updatedAt`, archive và restore qua `PATCH hidden`.
- Mở rộng `web/e2e/workspace.mjs`: tạo bot Echo qua hộp thoại, tìm thấy ở danh sách, sửa tên và instructions ở trang sửa, thấy chip Unsaved, bấm Save rồi tải lại để thấy đã lưu (và Discard bỏ đúng thay đổi), cài một mẫu từ thư viện, nhân bản, archive, lọc Archived, restore, xóa có gõ tên.
- Cập nhật baseline hình ảnh (`scripts/visual.mjs --update`) và ảnh README (`scripts/workspace-shots.mjs`).
- **Tiêu chí xong cả phase:** ba màn hình đúng như mục 2; test web và server xanh; chạy tay trên dữ liệu thật: sửa một bot đang dùng (đổi instructions, model, mức duyệt) và thấy bot chạy đúng cấu hình mới.

## 6. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| `SettingsForm` có nhiều trường và hiệu ứng phụ (cấp quyền thông báo, Chief of Staff, intake) | Chuyển nguyên khối từng phần, giữ test e2e hiện có, kiểm từng trường sau mỗi bước |
| Hai nơi sửa (panel chat và trang Agents) lệch nhau | Chỉ còn một nơi: panel chỉ có Overview/Activity/Inspector và mọi nút Settings dẫn sang trang sửa |
| Chuyển từ tự lưu sang Save: dễ mất thay đổi khi rời trang | Hỏi xác nhận khi rời, `Ctrl/⌘ S`, chip "Unsaved changes", test e2e Discard và Save |
| Mẫu agenticos nhắc đến kỹ năng, máy chủ MCP, bộ sưu tập riêng của nó | Chỉ chuyển tên, mô tả, instructions; ghi chú gợi ý trong mô tả, không tạo kỹ năng hay MCP giả |
| Giấy phép của mẫu | Apache-2.0: ghi `NOTICE` và nguồn trong từng tệp |
| Không có ảnh thật của trang tham chiếu | Dựa vào mã nguồn; đối chiếu bằng mắt sau khi đăng nhập ở bước 9.0 và ghi sai khác |
| Bot cũ không có `createdAt` | Để trống và hiện "—" |
| Khái niệm khác nhau (Draft/Publish, chia sẻ, đánh giá) khiến giao diện trống ở vài chỗ | Không đưa vào giao diện; ghi ở mục 7 |

## 7. Ngoài phạm vi

- Draft và Publish, phiên bản và lịch sử xuất bản, Evals, Gaps, Judge datasets, kiểm thử bản nháp.
- Chia sẻ theo người dùng, nhóm phòng ban, nhãn (categories, tags) theo agenticos, tải ảnh đại diện.
- Hai mẫu `general/agenticos` và `general/platform-assistant` (gắn với chính nền tảng agenticos); phần `capabilities`, `skills`, `mcp`, `attach`, `budget_usd` của mọi mẫu.
- Giới hạn số agent theo gói, hạn mức chi phí theo bot (xem kế hoạch RAG và ngân sách ở phase sau).

## 8. Quyết định của người dùng

1. **Tên:** gọi là **Agent** như agenticos (cả tiếng Việt).
2. **Lưu:** thêm nút **Save** ở trang sửa.
3. **Agent templates:** thư viện các agent định nghĩa sẵn, **chuyển từ agenticos** sang (mục 2.4).
4. **Panel chat:** bấm Settings thì chuyển sang giao diện sửa agent đầy đủ.
5. **Evals và Knowledge gaps:** là trang trống.

## 9. K?t qu? tri?n khai

?? ??i chi?u l?i ?ng d?ng agenticos v1.89.1, ghi s? ?o trong [agents-tokens.md](verification/agents-tokens.md), c?p nh?t giao di?n, d? li?u m?u offline, NOTICE/gi?y ph?p v? t?i li?u. C?c m?c ngo?i ph?m vi ? m?c 7 gi? nguy?n.

Ki?m th?: TypeScript v? ESLint qua; 61 test web, 101 test server qua; workspace e2e qua (Save/Discard, Memory, m?c duy?t, xung ??t, template, Duplicate, Archive/Restore, Delete/Undo v? b? c?c 360?1440 px). ?? c?p nh?t 31 baseline v? ?nh README. Th? g?i tin b?ng bot Echo c? d? li?u l?u th?t trong workspace th? ri?ng, tr?nh s?a bot ?ang d?ng ho?c ph?t sinh l??t CLI tr? ph?; ph?m vi n?y ???c ghi r? trong bi?n b?n x?c minh.

?? r? README, install.ps1 v? install.sh: c?p nh?t README/h??ng d?n; hai script c?i ??t kh?ng c?n ??i v? kh?ng th?m prerequisite, service, port hay bi?n m?i tr??ng. M?u ???c ??ng g?i trong wheel qua botteam/templates/**.
