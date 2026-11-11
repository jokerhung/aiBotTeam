# Phase 4 — Đội bot và tự động hoá

**Mục tiêu:** nhiều bot làm việc cùng nhau trong channel, bot giao việc cho bot qua một runtime duy nhất; lịch chạy định kỳ và webhook; hộp thông báo.

**Tham chiếu:** `docs/runtime-contract.md` (đọc kỹ trước khi làm), `server/runtime/`, `server/coordinator.ts`, `server/routes/groups.ts`, `channels.ts`, `server/decider/`, `server/drivers/agents-mcp.ts`, `agents-bridge.ts`, `shared/routines.ts`, `routine-schedule.ts`, `webhooks.ts`, `docs/routine-schedules.md`, `docs/decision-model.md`; `src/components/GroupView.tsx`, `RoomHeader.tsx`, `room-panel/`, `SidebarNewRoomPanel.tsx`, `RoutineCalendarPage.tsx`, `routines/`, `automations/`, `NotificationsPanel.tsx`, `inbox/`, `TeamMapPage.tsx`. Ảnh: `tasks-routines.png`, `docs-automations.png`, thư mục `triggers-v2/`.

## 1. Channel (phòng nhiều bot)

- [x] Dữ liệu `WireGroup`: tên, thành viên, chỉ dẫn chung, thư mục làm việc, quy tắc trả lời (`GroupDefaultResponder`: bot trưởng phòng / Auto / chỉ khi được nhắc), transcript riêng.
- [x] Route: `GET/POST /api/groups`, `PATCH/DELETE /api/groups/{id}`, `POST /api/groups/{id}/messages`, `POST /api/groups/{id}/read`, task trong phòng; frame `group`, `group.deleted`.
- [x] **GroupView:** giống ChatView nhưng mỗi tin bot có avatar + tên + màu định danh; header phòng (`RoomHeader`) với chồng avatar thành viên.
- [x] **@mention:** bộ chọn bật khi gõ `@`, tô nền mention trong ô nhập bằng lớp gương (`.mention-editor`, `.mention-highlight`), mention chính mình nổi bật hơn.
- [x] **RoomPanel** (panel phải): thành viên, chỉ dẫn, thư mục, quy tắc trả lời.
- [x] Tạo phòng từ sidebar (`SidebarNewRoomPanel`); phòng nằm chung danh sách với bot, xếp theo section.
- [x] Thứ tự lượt trong phòng: các lượt cùng phòng không chồng nhau; hàng đợi phòng (`RoomQueueEntry`) hiển thị được.
- [x] **Chọn người trả lời tự động (tuỳ chọn):** model quyết định nhanh qua endpoint tương thích OpenAI; tắt hoặc không chắc thì rơi về bot trưởng phòng.

## 2. Runtime giao việc

Cài theo `docs/runtime-contract.md`, bản rút gọn nhưng giữ các bất biến.

- [x] Bảng `assignments`, `assignment_events` (chỉ thêm), `inbox` trong `runtime.db`; mỗi chuyển trạng thái là một transaction ghi hàng + sự kiện trước khi hành động.
- [x] Vòng đời: `queued → running → completed | failed | cancelled`; `waiting` khi đã giao việc con; `needs_input` khi chờ người; `resume` khi mọi việc con xong.
- [x] Enqueue: kiểm cha đang chạy, cấm giao ngược lên tổ tiên, khử trùng (cùng brief + cùng người nhận + cùng cha), giới hạn độ sâu và ngân sách theo gốc (`requests`, `executions`, `wakes`). Từ chối trả về lý do có kiểu, không ném lỗi vào lượt.
- [x] Mức quyền: `level = max(own, inherited)`, chỉ thừa kế qua dòng dõi người/lịch và bị chặn theo khả năng engine.
- [x] Phong bì: mở đầu mỗi lượt được giao do harness viết từ dữ liệu lưu (`[From <ai> · <việc gì> · <thẩm quyền>]`), thoát mọi chuỗi giả mạo trong văn bản của model.
- [x] Khởi động lại: lượt bị cắt chạy lại tối đa một lần; đã hành động ra ngoài thì không chạy lại.
- [x] Dừng: lan xuống cây, là kết quả cuối `stopped` và được báo cáo.
- [x] Bộ kiểm bất biến I1–I10 chạy sau mỗi kịch bản test trên driver giả.

## 3. Công cụ giữa các bot

MCP server "agents" do harness sở hữu, gắn vào lượt của driver có `capabilities.agentsMcp`:

- [x] `list_bots`, `coordinate_bots(bot_ids, message, thread?, reply?, consult?, done_when?, answers?)`, `assignment_status(id?)`, `start_thread`, `list_threads`, `post_to_room`, `list_rooms`.
- [x] Danh sách công cụ giống hệt giữa các lượt của một cuộc trò chuyện (giữ cache prompt); cái gì không được làm thì trả lời lúc gọi.
- [x] **Chief of Staff:** một bot được đánh dấu quản lý section; mức quyền của nó chảy xuống việc nó giao; trả lời thay người cho câu hỏi bot khác đang chờ (thẻ ghi rõ ai trả lời).
- [x] UI: dòng "đang chờ đồng đội" (`waitingForTeammates`), thẻ tham chiếu thread (`threadRef`), tin từ bot khác có nhãn người gửi (`from`, `peerAsk`).
- [x] **TeamMapPage** (tuỳ chọn cuối phase): sơ đồ đội dạng canvas, đường nối có hiệu ứng `link-flow` khi bot đang làm.

## 4. Routine (lịch)

- [x] Dữ liệu: bot/phòng đích, lời nhắc, lịch (một lần · các ngày trong tuần · mỗi 5–1.440 phút), múi giờ, bật/tạm dừng, giới hạn thời gian chạy tuỳ chọn.
- [x] Bộ lập lịch asyncio + `croniter`: lịch theo khoảng bám mốc bắt đầu, **bỏ qua** lần chạy nếu lần trước còn đang chạy; sau khởi động lại không dồn chạy bù.
- [x] Mỗi lần chạy là một task mới với gốc `routine` trong runtime; ghi `RoutineRun` (trạng thái, thời lượng, liên kết thread).
- [x] Route: `GET/POST /api/routines`, `PATCH/DELETE /api/routines/{id}`, `POST /api/routines/{id}/run`, `POST /api/routine-runs/{id}/cancel`; frame `routine`, `routine.deleted`, `routine.run`.
- [x] Công cụ cho bot: `trigger_info`, `trigger` (create/update/pause/resume/run now), `delete_trigger`; tạo xong hiện thẻ sống trong chat với Edit · Pause · Undo.

## 5. Webhook

- [x] Bộ nhận riêng ở cổng 8900, chỉ có `/health` và `/hooks/...` — không lộ API chính.
- [x] Bí mật hiện một lần khi tạo/xoay vòng; xác thực Bearer (khuyến nghị) hoặc URL khả năng; lưu băm, so sánh thời gian hằng.
- [x] Nội dung webhook là dữ liệu ngoài: gốc `outside` trong runtime, không thừa kế thẩm quyền của người.
- [x] Ghi `WebhookAttempt` (thời điểm, mã trả về, kết quả); giới hạn kích thước body và tần suất.
- [x] Route: `GET/POST /api/webhooks`, `PATCH/DELETE /api/webhooks/{id}`, `POST /api/webhooks/{id}/rotate`; frame `webhook`, `webhook.attempt`, `webhook.deleted`.
- [x] Bot tạo webhook không bao giờ thấy bí mật; người dùng chép liên kết từ thẻ.

## 6. Trang Automations

Theo `RoutineCalendarPage.tsx` và `tasks-routines.png`:

- [x] Vào từ mục `Automations` ở chân sidebar (mục đang chọn có nền `raised`, icon lịch màu accent).
- [x] Header: icon + tiêu đề, phụ đề, nút `+ New routine` (accent, bo đầy).
- [x] Tab `Routines` / `Webhooks`; dòng giải thích Task và Routine.
- [x] Thanh điều hướng: `‹ Today ›`, tháng/năm, bộ lọc bot, chuyển `Day · 3 days · Week`.
- [x] Lưới lịch theo giờ với khối routine và lần chạy; danh sách nhật ký chạy có lọc trạng thái.
- [x] Trạng thái rỗng: mascot trong vòng tròn, tiêu đề, mô tả, nút "Create your first routine".
- [x] Trình tạo/sửa routine (bộ chọn giờ, ngày trong tuần, khoảng lặp).

## 7. Thông báo và hộp việc cần bạn

- [x] `NotificationLogEntry`: bot cần duyệt, lượt xong khi tab ẩn, routine lỗi; frame `notify`, `notifications.read`.
- [x] `NotificationsPanel` (panel phải, ghim được) và dải thông báo.
- [x] `InboxPanel`: gom mọi thẻ đang chờ người trên toàn bộ bot/phòng, trả lời tại chỗ.
- [x] Số chưa đọc trên tiêu đề tab; thông báo trình duyệt (xin quyền khi người dùng bật).

## 8. Kiểm thử

- [x] Runtime: bộ kịch bản trên driver giả (giao việc lồng nhau, câu hỏi của việc con, dừng giữa chừng, khởi động lại ở mỗi trạng thái, hết ngân sách), kiểm I1–I10.
- [x] Lập lịch: đồng hồ giả; bỏ qua khi chồng lần chạy; đổi múi giờ; giờ mùa hè.
- [x] Webhook: sai bí mật, body quá lớn, phát lại, bộ nhận không lộ route khác.
- [x] So ảnh: phòng nhiều bot, bộ chọn mention, trang Automations (rỗng và có dữ liệu), trình tạo routine, panel thông báo.

## Tiêu chí hoàn thành

1. Trong phòng có 3 bot, `@BotA` trả lời đúng bot; không nhắc ai thì bot trưởng phòng trả lời.
2. Bot A gọi `coordinate_bots` giao việc cho B và C → A chờ → được đánh thức một lần với kết quả của cả hai.
3. Tắt server khi B đang chạy rồi bật lại → B chạy lại đúng một lần, A vẫn nhận kết quả, không báo cáo trùng.
4. Routine "mỗi 5 phút" chạy đúng giờ, bỏ qua khi lần trước chưa xong, hiện trên lịch và nhật ký.
5. `curl` tới webhook với Bearer đúng → bot bắt đầu một task; sai bí mật → 401 và có bản ghi attempt.
6. Thẻ cần duyệt của bot bất kỳ hiện trong Inbox và trả lời được từ đó.
7. So ảnh các màn mục 8 đạt ngưỡng.

## Cập nhật sau đối chiếu (2026-11-10)

- **Lối vào Automations ở Simple:** không còn hàng cố định ở chân sidebar (chỉ có avatar + Connect apps); mở từ `SidebarFooterNav`/menu hồ sơ và từ bot panel (Routines). Hàng `Automations` ở chân sidebar là bản Advanced.
- **Chief of Staff "MausBot"** là bot mặc định của cài mới: tile đầu sidebar, `MausBotWelcome`, "Show MausBot in the sidebar" tắt được; các bot khác báo cáo cho Chief (`reportsTo`, `managedSections`). Làm tile + trang chào ở phase 1–3, quyền và ủy thác ở đây.
- Runtime giao việc, routine, webhook: không đổi (đọc `docs/runtime-contract.md`).

## Trạng thái triển khai

Đã làm xong toàn bộ phase (máy chủ: `runtime.py`, `host.py`, `agents.py`, `groups.py`, `routines.py`, `webhooks.py`, `notifications.py`; web: `GroupView`, `MentionEditor`, `RoomPanel`, `NewGroupDialog`, `AutomationsPage`, `NotificationsPanel`/`InboxPanel`, `TeamCards`, `TeamMapPage`).

- Kiểm thử máy chủ (Chief of Staff: `test_a_chief_with_sections_hands_work_only_inside_them`, `test_reports_to_scopes_a_chief_and_refuses_loops`): `server/tests` (130 ca: runtime và kịch bản I1–I10, phòng, routine với đồng hồ giả, webhook, Chief theo section và `reportsTo`). Web: vitest (28 ca; từ điển tiếng Việt được kiểm cho mọi chuỗi JSX, mọi `t("…")`/`tr("…")` và các cặp nhãn).
- Trình duyệt thật (bot `echo`, không gọi engine thật): `web/e2e/phase4.mjs` (phòng, @mention, trưởng phòng trả lời, chọn model quyết định, Automations rỗng/có dữ liệu, trình tạo routine, webhook 202/401 và bí mật hiện một lần, Inbox trả lời tại chỗ, thẻ giao việc, số chưa đọc trên tiêu đề tab).
- Tiêu chí 3 chạy đầu-cuối: `web/e2e/restart.mjs` bật máy chủ thật, giết giữa lúc B đang chạy, bật lại trên cùng dữ liệu; B chạy lại đúng một lần (`restarts=1`), A nhận đúng một báo cáo.
- So ảnh (tiêu chí 7), `web/e2e/visual.mjs`: chạy giao diện tham chiếu (cổng 5199) và bản của ta rồi so từng pixel bằng pixelmatch; mọi màn mục 8 đều có đối chiếu với tham chiếu:
  - Automations rỗng 1,0% (ngưỡng 4%); hộp thoại tạo routine "What should happen?" 2,5% (8%).
  - Automations dạng lịch có dữ liệu (ta có routine; bố cục như tham chiếu: lịch tháng nhỏ + "My bots" kéo-thả bên trái, thanh điều hướng, lưới giờ, đường giờ hiện tại): ô tháng 3,1%, tiêu đề tuần 0,9%, thanh điều hướng 1,7% (ngưỡng 6–8%). Khối routine của hai bên là dữ liệu riêng nên chỉ kiểm có hiện khối.
  - Trình tạo routine đầy đủ: chuỗi như tham chiếu (What should happen? → "Set it up yourself" → When → New automation); phần đầu hộp thoại (tiêu đề, When, ngày giờ, chip lặp) 2,3% (ngưỡng 10%).
  - Phòng nhiều bot với cùng ba thành viên: chồng avatar ở header 6,9%, bốn dòng đầu bộ chọn mention 4,1% (ngưỡng 10%), cộng đo hình học (vị trí tiêu đề, độ rộng/mép bộ chọn, cao dòng, ô nhập ≤ 12px). Phần tin nhắn không so vì hai bên có nội dung trò chuyện khác nhau.
  - Panel thông báo (bật "Show the notification feed" trên tham chiếu): đầu panel + ô lọc 3,3%, chân panel 3,0% (ngưỡng 10%); dòng thông báo là dữ liệu riêng của mỗi bên.
  - Inbox: panel bên phải như tham chiếu (tiêu đề, mở rộng, đóng, trạng thái rỗng "Nothing for you yet."); phần đầu panel lệch 3,1% (ngưỡng 10%). Hộp thoại webhook "When another app sends something" (Who should do it? / What should it do? / More / Set it up) dựng theo tham chiếu: đầu hộp 3,8%, chân hộp 6,9% (ngưỡng 10%). Bí mật webhook hiện một lần ở tab Webhooks sau khi tạo.
  - Danh sách có dữ liệu: như tham chiếu, mọi tự động hóa nằm trong một thẻ bo tròn rộng 720px, mỗi dòng cách nhau bằng đường kẻ (chấm trạng thái, tiêu đề, mô tả, dòng trạng thái, công tắc 44×24); routine và webhook cùng một danh sách. **Webhook có dữ liệu so với đúng webhook của tham chiếu:** `visual.mjs` tạo cùng một webhook ("Deploy events", bot QA, tạm dừng) ở hai bên — bên tham chiếu qua REST `POST /api/webhooks` của nó (không khởi động lượt bot nào; đọc từ mã nguồn OpenMausBot `server/routes/webhooks.ts`, mã nguồn cũng cho thấy nút "Set it up" gửi tin cho bot nên không dùng) và xóa ngay trong `finally` — rồi so dòng với dòng: lệch 3,0% (ngưỡng 6%). Thẻ routine so với thẻ "Keep an eye on my day" của tham chiếu: kích thước 1,1%, cột chấm trạng thái 4,9%, cột công tắc 2,2% (ngưỡng 10%). Inbox có thêm mục "Active Threads" (cuộc trò chuyện đang làm hoặc chưa đọc) dưới các thẻ như tham chiếu; phần đầu mục này so với ảnh chụp panel của tham chiếu lưu trong repo (`web/e2e/reference/inbox-active-threads-1360x860.png`): 5,5% (ngưỡng 10%). Thẻ chờ duyệt có dữ liệu của tham chiếu không sinh được: đã thử cho một bot thật chạy `ask_user` trong tham chiếu (được người dùng cho phép) nhưng bot QA báo "Start docker first (App Settings → Computers)" vì máy tính của nó chưa bật, nên không có thẻ; vì vậy thẻ inbox của ta (dùng chung `QuestionCard`/`ApprovalDock` với chat) và được so với thẻ câu hỏi ở `question-cards-preview.html` của tham chiếu (cùng tên bot và câu hỏi): 0,5%; tham chiếu không có cách tạo thẻ chờ duyệt thật mà không chạy bot, nên đây là phép so trên đúng component của nó. Tham chiếu tự sinh routine "Keep an eye on my day" theo thời gian; khi đó trạng thái rỗng của nó không còn trên màn hình, nên `visual.mjs` so trang Automations rỗng của ta (1280×800) với ảnh chụp trạng thái rỗng của tham chiếu lưu trong repo (`web/e2e/reference/automations-empty-1280x800.png`): 1,0% (ngưỡng 4%); header trang Automations so trực tiếp với tham chiếu ở cả hai trạng thái: 6,9% (ngưỡng 8%).
- Header Automations đúng mục 6: icon lịch (màu accent) + tiêu đề + phụ đề + nút `+ New routine` + bộ lọc + List/Calendar; tab Routines/Webhooks nằm trong header; dòng giải thích Task và Routine ở đầu danh sách. Phần còn lại (lưới, nút, bộ lọc) theo giao diện tham chiếu :5199 (AGENTS.md); trang dạng lịch phủ toàn màn hình như tham chiếu.
- Chọn người trả lời tự động: `GET/PUT /api/decider`; chọn model trong RoomPanel khi phòng ở chế độ Automatic (tắt = bot trưởng phòng).
- Chief of Staff: `chief`, `managedSections`, `reportsTo` (bot panel → Settings); Chief chỉ giao việc cho bot trong section nó quản lý hoặc báo cáo cho nó; không cho vòng báo cáo.
- Cổng nhận webhook: `WEBHOOK_PORT` (mặc định 8900) trong `.env`.
- Chief of Staff trả lời thay người: `coordinate_bots(answers=…)` chỉ Chief hoặc bot đã giao việc mới được dùng (`not_allowed` với bot khác); thẻ câu hỏi ghi "<tên> answered for you"; test `test_a_chief_answers_a_childs_question_for_the_person_and_the_card_says_who`. Kèm sửa: việc được giao chuyển `running → needs_input → running` khi có thẻ chờ người (trước đây không bao giờ xảy ra).
- Tiếng Việt: ngoài kiểm nguồn (`i18n.test.ts`), `web/e2e/vi.mjs` bật tiếng Việt, đi qua mọi màn Phase 4 và liệt kê chữ tiếng Anh còn hiển thị (không kể dữ liệu người dùng viết); hiện không còn chuỗi nào. Bộ bản địa hoá giờ dịch cả `placeholder`/`title`/`aria-label` của ô nhập.
