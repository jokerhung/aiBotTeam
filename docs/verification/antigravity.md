# Antigravity — kết quả spike (Phase 7.0, một phần)

Máy: Windows, `agy` **1.5.13**, đã đăng nhập (ngày 2026-11-20).

## Đã xác nhận
- `agy models` (không cần cờ nào) in mỗi dòng `id<TAB>tên`: `gemini-3.8-flash-high|medium|low`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`. Mức suy luận nằm trong id model nên `effortLevels` có thể để trống. Chưa đăng nhập thì lệnh này báo "Please sign in".
- **Chế độ in** `agy -p "<lời nhắc>" --output-format stream-json` in NDJSON:
  - `{"event":"init","conversation_id":…,"init":{"cwd","tools":[…],"permission_mode":"request-review"}}`
  - `{"event":"step_update","step_update":{"step_index","state":"ACTIVE|DONE","step_type":"user_input|agent_response|…","text_delta","usage"}}`
  - `{"event":"result","result":{"conversation_id","status":"SUCCESS","response","duration_seconds","usage"}}`
  - Một lượt đơn giản ~6 giây. Chế độ mặc định là `request-review` (xin duyệt).
- **ACP** `agy acp`: `initialize` trả `protocolVersion 1`, `agentInfo Antigravity ACP Server 1.5.13`, `promptCapabilities.image = true`, `embeddedContext = true`, `sessionCapabilities` có `resume`, `close`, `load`, `list`, `additionalDirectories`, `_meta.antigravity.systemPrompt.append = true`, `authMethods`: `oauth-personal`, `oauth-business`, `gemini-api-key`, `agent-platform`.

## Trả lời các câu hỏi mục 11 của kế hoạch
1. `agy acp` có sẵn dùng được, **không cần tải `agy_acp_server` riêng**.
6. Ảnh: ACP báo `image: true` → `Capabilities.images = True`.
7. Prompt hệ thống: ACP cho **append system prompt** (`_meta.antigravity.systemPrompt.append`), dùng cho `system` và kỹ năng.
9. `session/resume` có; còn `load`/`list`/`close`.
4. Model: lấy từ `agy models`, không cần `configOptions`.

## Còn phải kiểm
2 (cách cài không tương tác), 3 (stream-json xin quyền ra sao, có MCP riêng không), 5 (optionId quyền), 8 (nhiều session một tiến trình), 10 (TEMP/khởi động trên Windows), chạy `session/new` + `session/prompt` + `session/request_permission` thật.

## Kiểm thật qua driver (BotTeam), 2026-11-20
- Chat + công cụ `write_file` (Full): tạo được file; `session/resume` nhớ ngữ cảnh sau khi tắt tiến trình.
- Quyền (Ask): `session/request_permission` có `options` `allow` (allow_once) / `deny` (reject_once); lệnh shell ngoài thư mục xin quyền, ghi file trong thư mục làm việc thì không. Id yêu cầu là chuỗi.
- MCP: `session/new.mcpServers` nạp được `botteam.mcp_bridge`; tool tên `mcp_bt_list_bots`; gọi được `list_bots` qua broker.
- `session/prompt` trả `stopReason` và `usage` (inputTokens, outputTokens, cachedReadTokens, thoughtTokens). Suy nghĩ đến dưới dạng `agent_thought_chunk`.
- Khởi động ~1,5 giây, không giải nén TEMP.
- Ảnh qua ACP: ảnh PNG đỏ 16x16 được nhận ra là "Red". `session/cancel` giữa lúc đang đếm số: lượt kết thúc `interrupted`, bot dùng tiếp được.
- Edits (`session/set_mode accept-edits`): ghi `edit.txt` không hỏi; lệnh `echo hi` (chỉ-đọc) broker tự duyệt, không hiện thẻ.
- Windows, 5 session liên tiếp (5 tiến trình `agy`, mỗi lượt 5–7 giây): sau `stop_all` còn 0 tiến trình `agy`, 0 thư mục `_MEI`, số mục trong TEMP không đổi. Không cần dọn TEMP hay dùng chung tiến trình.
- Đăng nhập: khi chưa đăng nhập tiến trình in "Open the following link to authenticate the ACP server: <url>" trên stderr; driver đưa liên kết vào thông báo lỗi (kiểm bằng tác tử giả).

## `steer` (tin gửi khi lượt đang chạy), 2026-11-20
Gửi `session/prompt` thứ hai trong lúc lượt đầu đang đếm số: `agy` không điều hướng lượt đang chạy. Kết quả của lượt đầu trả `end_turn` ngay khi tin thứ hai tới, lượt đầu vẫn đếm hết đến 80, rồi mới trả lời tin thứ hai (BANANA). Tức là tin thứ hai chỉ xếp hàng chứ không đổi hướng, và kết quả lượt đầu đến sớm làm lệch việc đếm lượt của BotTeam. Vì vậy `steer` giữ `refused` và BotTeam tự xếp hàng tin mới (như Codex); cách này chính xác hơn.
