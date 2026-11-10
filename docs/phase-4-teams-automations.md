# Phase 4 — Đội bot và tự động hoá

**Mục tiêu:** nhiều bot làm việc cùng nhau trong channel, bot giao việc cho bot qua một runtime duy nhất; lịch chạy định kỳ và webhook; hộp thông báo.

**Tham chiếu:** `docs/runtime-contract.md` (đọc kỹ trước khi làm), `server/runtime/`, `server/coordinator.ts`, `server/routes/groups.ts`, `channels.ts`, `server/decider/`, `server/drivers/agents-mcp.ts`, `agents-bridge.ts`, `shared/routines.ts`, `routine-schedule.ts`, `webhooks.ts`, `docs/routine-schedules.md`, `docs/decision-model.md`; `src/components/GroupView.tsx`, `RoomHeader.tsx`, `room-panel/`, `SidebarNewRoomPanel.tsx`, `RoutineCalendarPage.tsx`, `routines/`, `automations/`, `NotificationsPanel.tsx`, `inbox/`, `TeamMapPage.tsx`. Ảnh: `tasks-routines.png`, `docs-automations.png`, thư mục `triggers-v2/`.

## 1. Channel (phòng nhiều bot)

- [ ] Dữ liệu `WireGroup`: tên, thành viên, chỉ dẫn chung, thư mục làm việc, quy tắc trả lời (`GroupDefaultResponder`: bot trưởng phòng / Auto / chỉ khi được nhắc), transcript riêng.
- [ ] Route: `GET/POST /api/groups`, `PATCH/DELETE /api/groups/{id}`, `POST /api/groups/{id}/messages`, `POST /api/groups/{id}/read`, task trong phòng; frame `group`, `group.deleted`.
- [ ] **GroupView:** giống ChatView nhưng mỗi tin bot có avatar + tên + màu định danh; header phòng (`RoomHeader`) với chồng avatar thành viên.
- [ ] **@mention:** bộ chọn bật khi gõ `@`, tô nền mention trong ô nhập bằng lớp gương (`.mention-editor`, `.mention-highlight`), mention chính mình nổi bật hơn.
- [ ] **RoomPanel** (panel phải): thành viên, chỉ dẫn, thư mục, quy tắc trả lời.
- [ ] Tạo phòng từ sidebar (`SidebarNewRoomPanel`); phòng nằm chung danh sách với bot, xếp theo section.
- [ ] Thứ tự lượt trong phòng: các lượt cùng phòng không chồng nhau; hàng đợi phòng (`RoomQueueEntry`) hiển thị được.
- [ ] **Chọn người trả lời tự động (tuỳ chọn):** model quyết định nhanh qua endpoint tương thích OpenAI; tắt hoặc không chắc thì rơi về bot trưởng phòng.

## 2. Runtime giao việc

Cài theo `docs/runtime-contract.md`, bản rút gọn nhưng giữ các bất biến.

- [ ] Bảng `assignments`, `assignment_events` (chỉ thêm), `inbox` trong `runtime.db`; mỗi chuyển trạng thái là một transaction ghi hàng + sự kiện trước khi hành động.
- [ ] Vòng đời: `queued → running → completed | failed | cancelled`; `waiting` khi đã giao việc con; `needs_input` khi chờ người; `resume` khi mọi việc con xong.
- [ ] Enqueue: kiểm cha đang chạy, cấm giao ngược lên tổ tiên, khử trùng (cùng brief + cùng người nhận + cùng cha), giới hạn độ sâu và ngân sách theo gốc (`requests`, `executions`, `wakes`). Từ chối trả về lý do có kiểu, không ném lỗi vào lượt.
- [ ] Mức quyền: `level = max(own, inherited)`, chỉ thừa kế qua dòng dõi người/lịch và bị chặn theo khả năng engine.
- [ ] Phong bì: mở đầu mỗi lượt được giao do harness viết từ dữ liệu lưu (`[From <ai> · <việc gì> · <thẩm quyền>]`), thoát mọi chuỗi giả mạo trong văn bản của model.
- [ ] Khởi động lại: lượt bị cắt chạy lại tối đa một lần; đã hành động ra ngoài thì không chạy lại.
- [ ] Dừng: lan xuống cây, là kết quả cuối `stopped` và được báo cáo.
- [ ] Bộ kiểm bất biến I1–I10 chạy sau mỗi kịch bản test trên driver giả.

## 3. Công cụ giữa các bot

MCP server "agents" do harness sở hữu, gắn vào lượt của driver có `capabilities.agentsMcp`:

- [ ] `list_bots`, `coordinate_bots(bot_ids, message, thread?, reply?, consult?, done_when?, answers?)`, `assignment_status(id?)`, `start_thread`, `list_threads`, `post_to_room`, `list_rooms`.
- [ ] Danh sách công cụ giống hệt giữa các lượt của một cuộc trò chuyện (giữ cache prompt); cái gì không được làm thì trả lời lúc gọi.
- [ ] **Chief of Staff:** một bot được đánh dấu quản lý section; mức quyền của nó chảy xuống việc nó giao; trả lời thay người cho câu hỏi bot khác đang chờ (thẻ ghi rõ ai trả lời).
- [ ] UI: dòng "đang chờ đồng đội" (`waitingForTeammates`), thẻ tham chiếu thread (`threadRef`), tin từ bot khác có nhãn người gửi (`from`, `peerAsk`).
- [ ] **TeamMapPage** (tuỳ chọn cuối phase): sơ đồ đội dạng canvas, đường nối có hiệu ứng `link-flow` khi bot đang làm.

## 4. Routine (lịch)

- [ ] Dữ liệu: bot/phòng đích, lời nhắc, lịch (một lần · các ngày trong tuần · mỗi 5–1.440 phút), múi giờ, bật/tạm dừng, giới hạn thời gian chạy tuỳ chọn.
- [ ] Bộ lập lịch asyncio + `croniter`: lịch theo khoảng bám mốc bắt đầu, **bỏ qua** lần chạy nếu lần trước còn đang chạy; sau khởi động lại không dồn chạy bù.
- [ ] Mỗi lần chạy là một task mới với gốc `routine` trong runtime; ghi `RoutineRun` (trạng thái, thời lượng, liên kết thread).
- [ ] Route: `GET/POST /api/routines`, `PATCH/DELETE /api/routines/{id}`, `POST /api/routines/{id}/run`, `POST /api/routine-runs/{id}/cancel`; frame `routine`, `routine.deleted`, `routine.run`.
- [ ] Công cụ cho bot: `trigger_info`, `trigger` (create/update/pause/resume/run now), `delete_trigger`; tạo xong hiện thẻ sống trong chat với Edit · Pause · Undo.

## 5. Webhook

- [ ] Bộ nhận riêng ở cổng 8900, chỉ có `/health` và `/hooks/...` — không lộ API chính.
- [ ] Bí mật hiện một lần khi tạo/xoay vòng; xác thực Bearer (khuyến nghị) hoặc URL khả năng; lưu băm, so sánh thời gian hằng.
- [ ] Nội dung webhook là dữ liệu ngoài: gốc `outside` trong runtime, không thừa kế thẩm quyền của người.
- [ ] Ghi `WebhookAttempt` (thời điểm, mã trả về, kết quả); giới hạn kích thước body và tần suất.
- [ ] Route: `GET/POST /api/webhooks`, `PATCH/DELETE /api/webhooks/{id}`, `POST /api/webhooks/{id}/rotate`; frame `webhook`, `webhook.attempt`, `webhook.deleted`.
- [ ] Bot tạo webhook không bao giờ thấy bí mật; người dùng chép liên kết từ thẻ.

## 6. Trang Automations

Theo `RoutineCalendarPage.tsx` và `tasks-routines.png`:

- [ ] Vào từ mục `Automations` ở chân sidebar (mục đang chọn có nền `raised`, icon lịch màu accent).
- [ ] Header: icon + tiêu đề, phụ đề, nút `+ New routine` (accent, bo đầy).
- [ ] Tab `Routines` / `Webhooks`; dòng giải thích Task và Routine.
- [ ] Thanh điều hướng: `‹ Today ›`, tháng/năm, bộ lọc bot, chuyển `Day · 3 days · Week`.
- [ ] Lưới lịch theo giờ với khối routine và lần chạy; danh sách nhật ký chạy có lọc trạng thái.
- [ ] Trạng thái rỗng: mascot trong vòng tròn, tiêu đề, mô tả, nút "Create your first routine".
- [ ] Trình tạo/sửa routine (bộ chọn giờ, ngày trong tuần, khoảng lặp).

## 7. Thông báo và hộp việc cần bạn

- [ ] `NotificationLogEntry`: bot cần duyệt, lượt xong khi tab ẩn, routine lỗi; frame `notify`, `notifications.read`.
- [ ] `NotificationsPanel` (panel phải, ghim được) và dải thông báo.
- [ ] `InboxPanel`: gom mọi thẻ đang chờ người trên toàn bộ bot/phòng, trả lời tại chỗ.
- [ ] Số chưa đọc trên tiêu đề tab; thông báo trình duyệt (xin quyền khi người dùng bật).

## 8. Kiểm thử

- [ ] Runtime: bộ kịch bản trên driver giả (giao việc lồng nhau, câu hỏi của việc con, dừng giữa chừng, khởi động lại ở mỗi trạng thái, hết ngân sách), kiểm I1–I10.
- [ ] Lập lịch: đồng hồ giả; bỏ qua khi chồng lần chạy; đổi múi giờ; giờ mùa hè.
- [ ] Webhook: sai bí mật, body quá lớn, phát lại, bộ nhận không lộ route khác.
- [ ] So ảnh: phòng nhiều bot, bộ chọn mention, trang Automations (rỗng và có dữ liệu), trình tạo routine, panel thông báo.

## Tiêu chí hoàn thành

1. Trong phòng có 3 bot, `@BotA` trả lời đúng bot; không nhắc ai thì bot trưởng phòng trả lời.
2. Bot A gọi `coordinate_bots` giao việc cho B và C → A chờ → được đánh thức một lần với kết quả của cả hai.
3. Tắt server khi B đang chạy rồi bật lại → B chạy lại đúng một lần, A vẫn nhận kết quả, không báo cáo trùng.
4. Routine "mỗi 5 phút" chạy đúng giờ, bỏ qua khi lần trước chưa xong, hiện trên lịch và nhật ký.
5. `curl` tới webhook với Bearer đúng → bot bắt đầu một task; sai bí mật → 401 và có bản ghi attempt.
6. Thẻ cần duyệt của bot bất kỳ hiện trong Inbox và trả lời được từ đó.
7. So ảnh các màn mục 8 đạt ngưỡng.
