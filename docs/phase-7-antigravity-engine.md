# Phase 7 — Engine Antigravity (`agy`)

**Mục tiêu:** bot chạy được bằng **Antigravity** của Google giống cách đã chạy bằng Claude Code và Codex: chọn trong danh sách engine/model, chat có streaming và thẻ công cụ, duyệt quyền theo bốn mức (Ask / Edits / Auto / Full), dùng được công cụ đội (`list_bots`, `coordinate_bots`…), MCP server riêng, tiếp tục cuộc trò chuyện sau khi khởi động lại, bấm Stop, hàng đợi, và hiện đúng trạng thái "chưa cài / chưa đăng nhập".

**Trạng thái:** đã triển khai (xem mục 15 cho những chỗ khác với kế hoạch ban đầu). Kết quả kiểm với `agy` thật: [verification/antigravity.md](verification/antigravity.md).

**Tham chiếu**

- BotTeam: `server/botteam/drivers/base.py` (hợp đồng driver `ProviderAdapter`, `SendTurnInput`, `Capabilities`), `drivers/claude.py` (tiến trình `claude -p` stream-json mỗi thread), `drivers/codex_app.py` (JSON-RPC với `codex app-server`, duyệt MCP qua `elicitation`), `drivers/proc.py`, `registry.py` (dò engine, `Instance`, `KEY_CATALOG`), `approval.py` (`claude_permission_mode`, `codex_sandbox`), `broker.py`, `mcp_bridge.py`, `web/components/Welcome.tsx`, `ModelMenu.tsx`, `SettingsModal.tsx`.
- Bản gốc (quy tắc dự án: xem trước khi làm): `OpenMausBot/server/drivers/antigravity-acp.ts`, `antigravity-runtime.ts`, `antigravity-account.ts`, `antigravity-release.ts`, `antigravity-temp.ts`, `drivers/acp/core.ts` (client ACP dùng chung), `acp/steer.ts`, `acp/turn-state.ts`; `docs/approval-levels.md` (mục "Antigravity: Ask, Edits, or Auto"), `docs/agents-tool-bridge.md`, `shared/approval-mode.ts`, `shared/tool-scope-support.ts`.
- Phase 5 §1 (MCP riêng), `docs/user-guide.md` §3 (cấu hình engine), `install.ps1` / `install.sh` (cờ `-Claude` / `-Codex`).

## 1. Cách Claude và Codex đang được hỗ trợ (khuôn để theo)

| Việc | Claude Code | Codex | Antigravity (kế hoạch) |
|---|---|---|---|
| Tiến trình | Một `claude -p` stream-json sống lâu mỗi thread | `codex app-server` (JSON-RPC), một thread Codex mỗi thread BotTeam | **Giao thức ACP** (`agy acp`, JSON-RPC qua stdio), một tiến trình dùng chung nhiều session (mục 4) |
| Lớp driver | `ClaudeDriver(Emitter)` | `CodexAppDriver(Emitter)` | `AntigravityDriver(Emitter)` trên một client ACP viết riêng (`drivers/acp.py`) |
| Sự kiện | Đổi dòng stream-json thành `RuntimeEvent` (`content.delta`, `item.*`, `turn.completed`…) | Đổi thông báo JSON-RPC | Đổi `session/update` (`agent_message_chunk`, `tool_call`, `tool_call_update`, `plan`…) và kết quả `session/prompt` (`stopReason`, `usage`) |
| Duyệt quyền | `--permission-prompt-tool mcp__bt__approve` → permission broker | `mcpServer/elicitation/request` → broker | `session/request_permission` → **cùng broker**, trả về đúng `optionId` agent đưa ra |
| Công cụ đội | MCP stdio `botteam.mcp_bridge` qua `--mcp-config` | Gắn bridge bằng `-c mcp_servers…` (`mount_agents`) | MCP stdio `botteam.mcp_bridge` trong `mcpServers` của `session/new` |
| MCP riêng | `inp.custom_mcp` ghép vào cùng file cấu hình | `mcp_overrides` | `inp.custom_mcp` đổi sang dạng ACP trong `mcpServers` |
| Mức duyệt → engine | `claude_permission_mode()` | `codex_sandbox()` | `antigravity_mode()` (mục 5) |
| Tiếp tục | `--resume <session id>` | `thread/resume` | `session/resume` (Antigravity không dùng `session/load`) |
| Stop | Ngắt tiến trình/`interrupt` | `turn/interrupt` | `session/cancel` (chờ xác nhận; không dừng thì giết tiến trình) |
| Dò engine | `claude --version`, `claude auth status` | `codex --version`, `codex login status` | `agy --version`, thử `agy models` (cần đăng nhập) — mục 3 |
| Trong UI | `Welcome.tsx` (`SETUP`), `ModelMenu`, Settings → Engines | như bên trái | thêm một mục `antigravity` ở các chỗ đó, không đổi cấu trúc |

## 2. Đã kiểm trên máy này

- `agy` bản **1.5.12** ở `C:\Users\jkhung\AppData\Local\agy\bin\agy.EXE`, nằm trên PATH của người dùng.
- (Lúc viết kế hoạch chưa đăng nhập; nay đã đăng nhập, xem verification.) `agy models` khi chưa đăng nhập báo "Please sign in to view available models. Launch the CLI without arguments to sign in."
- Cờ và lệnh con thấy trong `agy --help` (chưa chạy thử vì chưa đăng nhập):
  - Chế độ in: `-p/--print`, `--output-format text|json|stream-json`, `--input-format stream-json` (mỗi dòng NDJSON là một lượt, cần `--output-format stream-json`), `--print-timeout`, `--json-schema`.
  - Quyền và chế độ: `--mode accept-edits|auto|plan`, `--dangerously-skip-permissions`, `--sandbox`.
  - Phiên: `--continue`, `--conversation <id>`, `--model`, `--effort low|medium|high|xhigh|max`, `--add-dir`, `--settings '<JSON>'` (chỉ cho phiên này, không lưu), `--agent`, `--project`.
  - Lệnh con: `acp` (máy chủ ACP stdio), `models`, `agents`, `mcp add|remove|list|enable|disable`, `plugin`, `update`, `remote-control`.
  - Ngoài phạm vi: `--remote-agent`, `--remote-control`, `mic-serve`.
- `agy acp` có cờ `--app-data-dir`, `--cli_dir_name`, `--cli_log_file`, `--dangerously-skip-permissions`, `--add-dir`, `--agent`, `--disable-telemetry`.
- **OpenMausBot đã chạy Antigravity qua ACP** (không qua chế độ in), nên chọn ACP là đường đã có người đi. Nó tải riêng bản `agy_acp_server` (1.4.3, ghim SHA-256) từ dl.google.com; bản `agy` 1.5.12 đã có sẵn `acp`, nên ta thử dùng `agy acp` có sẵn trước, không tự tải (câu hỏi 1, mục 11).

## 3. Phát hiện, đăng nhập và danh sách model (Phase 7.1)

- [x] `registry.py`: engine mới `antigravity` ("Antigravity"), tìm theo thứ tự: đường dẫn ghi trong cấu hình engine, `shutil.which("agy")`, `%LOCALAPPDATA%\agy\bin\agy.exe` (Windows) hoặc `~/.local/bin/agy` (cách cài chính thức do Google công bố; xác nhận ở spike). Không tìm thấy → `unavailable`, lý do "agy CLI not found on PATH".
- [x] Phiên bản: `agy --version` (dòng đầu).
- [x] Đã đăng nhập chưa: chưa thấy lệnh `auth status`; dùng `agy models` có thời hạn 10 giây. Mã thoát 0 và có danh sách → đã đăng nhập; thông báo "Please sign in" → `signed_in = False` kèm lý do "Sign in: chạy `agy` một lần"; không chạy được → `None`. **Không** mở trình duyệt và không treo chờ đăng nhập.
- [x] Model: lấy từ `agy models` khi đã đăng nhập, lưu cache vào `Instance.models`; nếu chưa đăng nhập hiện một mục `default` ("Antigravity (account default)") như Claude/Codex. Chọn `default` thì không truyền `--model`.
- [x] Mức suy luận: id model của `agy models` đã gồm mức (`gemini-3.8-flash-high`…), nên `effortLevels` để trống (ô chọn không hiện); nếu một lượt vẫn mang `effort`, driver gửi `session/set_config_option thought_level` và bỏ qua lỗi.
- [x] Giữ khóa API ngoài đường đi: bỏ khỏi môi trường của tiến trình `agy` các biến làm nó đổi cách xác thực (`GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_GENAI_USE_VERTEXAI`…), giống `REMOVED_ENVIRONMENT_KEYS` của OpenMausBot, để bot luôn dùng tài khoản đã đăng nhập.
- **Tiêu chí:** Settings → Engines và màn chào hiện "Antigravity" với trạng thái đúng trong ba trường hợp: chưa cài, chưa đăng nhập, sẵn sàng; không có lượt chạy nào được mở.

## 4. Client ACP và driver (Phase 7.2)

**Vì sao ACP, không phải chế độ in:** ACP cho từng session một danh sách MCP server riêng (công cụ đội và MCP riêng của bot), gửi yêu cầu quyền ra ngoài để broker trả lời, có `session/cancel`, đổi model trong session và `session/resume`. Chế độ in stream-json chỉ có `--mode`/`--dangerously-skip-permissions` cho quyền và cấu hình MCP toàn cục qua `agy mcp add` (ghi vào cấu hình của người dùng, không an toàn cho nhiều bot). Phase 7.0 vẫn đo cả hai trước khi chốt (mục 11).

- [x] Client ACP (JSON-RPC theo dòng, `initialize`, `session/new|resume|prompt|cancel|set_model|set_mode|set_config_option`, thông báo `session/update`, yêu cầu ngược `session/request_permission`, dòng tối đa 32 MB, tiến trình chết thì mọi yêu cầu đang chờ báo lỗi) **nằm trong `drivers/antigravity.py`**, không tách `acp.py`: chưa có engine ACP thứ hai để dùng chung. Tách khi cần.
- [x] `drivers/antigravity.py`: `AntigravityDriver(Emitter)` với `provider = "antigravity"`, cùng hợp đồng `ProviderAdapter`:
  - `send_turn`: tạo hoặc tiếp tục session (khóa theo `thread_id`), gửi `session/prompt` gồm `system` (nếu có), chữ, tệp đính kèm dạng danh sách đường dẫn như `with_attachments()` của Claude, ảnh nếu agent nhận (mục 7). Phát `turn.started`, các `content.delta`, `item.started/completed` cho công cụ, `turn.completed` với `ok` và `stopReason` suy từ kết quả `session/prompt`.
  - `interrupt_turn`: `session/cancel`; quá 3 giây không dừng thì giết tiến trình dùng chung của session đó (`kill_tree`) và tạo lại ở lượt sau.
  - `steer`: ban đầu trả `"refused"` (BotTeam xếp hàng tin mới); thử `acp/steer` của OpenMausBot ở phase sau nếu có nhu cầu.
  - `stop_all`: đóng session, chờ tiến trình tự thoát tối đa 5 giây rồi mới giết (Windows: giết cưỡng bức làm sót tệp đã giải nén, mục 8).
- [x] Nhận diện lỗi và báo bằng một dòng dễ hiểu, như `AUTH_FAILURE` / `USAGE_LIMIT` của Claude: chưa đăng nhập (`stopReason: auth_required`), hết hạn mức, hết thời gian khởi động, tiến trình thoát (kèm đuôi stderr, đã bỏ bí mật).
- [x] `usage`/`cost`: lấy từ kết quả `session/prompt` nếu có; không có thì để trống (không bịa).
- **Tiêu chí:** với driver giả ACP (mục 10), một lượt chat có chữ chảy dần, thẻ công cụ chạy rồi xong, Stop dừng được, tiến trình chết giữa lượt cho `runtime.error` rõ ràng và bot dùng tiếp được ở lượt sau.

## 5. Mức duyệt và công cụ (Phase 7.3)

Bốn mức của BotTeam áp vào Antigravity (đề xuất, xác nhận ở spike; OpenMausBot đã thử các chế độ native `default`, `auto_edit`, `yolo`):

| Mức | Chế độ Antigravity | Ai trả lời yêu cầu quyền |
|---|---|---|
| Ask | mặc định (mỗi hành động xin phép) | Broker hỏi người dùng qua thẻ duyệt |
| Edits | `accept-edits`: sửa file tự động | Lệnh và công cụ khác vẫn xin; broker trả lời |
| Auto | mặc định | Broker tự duyệt lệnh chỉ-đọc theo `is_readonly_command()`, còn lại hỏi (như Claude ở mức Auto) |
| Full | `auto` / `--dangerously-skip-permissions` | Không hỏi; riêng `ALWAYS_ASK` (ví dụ `TeamMemory`) vẫn hỏi |

- [x] `approval.py`: `antigravity_mode(mode)` kèm test bảng trên, cùng chỗ với `claude_permission_mode` và `codex_sandbox`. Giá trị lạ rơi về Ask (fail-closed).
- [x] Yêu cầu `session/request_permission` đưa vào permission broker như Claude/Codex; trả lời ghép đúng `optionId` agent đưa (cho phép một lần / từ chối; "luôn cho phép trong session" chỉ khi người dùng chọn rõ). Không ai trả lời trong thời hạn → từ chối (fail-closed), như các engine khác.
- [x] Công cụ đội: `botteam.mcp_bridge` là MCP stdio trong `session/new.mcpServers` (biến `BT_AGENTS`, `BT_BROKER_PORT`, `BT_BROKER_TOKEN`, `BT_THREAD_ID` như `claude.py`), gồm `list_bots`, `coordinate_bots`, `ask_user`, `remember`… Công cụ của bridge không cần thẻ duyệt (`OWN_PREFIX`).
- [x] MCP riêng của bot (`custom_mcp`): đổi sang dạng ACP (`stdio`: command/args/env; `http`/`sse`: url + headers). Header là bí mật: chỉ đi trong tham số session, không ghi log. Ngân sách ký tự và bộ lọc `allowTools`/cache đã nằm ở proxy MCP của BotTeam nên không cần làm lại.
- [x] Kỹ năng: BotTeam đã chép nội dung kỹ năng vào `system` cho engine không phải Claude (`turns.py`), và `system` được đặt đầu tin đầu của session mới; `--add-dir` được truyền khi có `skills_dir`.
- [x] `engine_caps` = `{"edits": true, "nativeReviewer": false, "agentsMcp": true, "resume": true}` (xác nhận ở spike).
- **Tiêu chí:** với driver giả, đủ bốn mức cho đúng kết quả cho cùng một chuỗi yêu cầu; Auto tự duyệt `ls` nhưng hỏi `rm`; Full không hỏi nhưng `TeamMemory` vẫn hỏi; bot gọi được `coordinate_bots` và `list_bots`.

## 6. Tiếp tục, hàng đợi, model, mức suy luận (Phase 7.4)

- [x] `resume_cursor` = mã session Antigravity. Lượt sau (hoặc sau khi khởi động lại BotTeam) gọi `session/resume`; session cũ không còn thì mở session mới và báo một dòng "đã bắt đầu cuộc trò chuyện mới" (không tự đưa lại cả lịch sử, trừ khi `strictResume` buộc phải thế).
- [x] `session_reset=True` (kênh Telegram/Zalo, mỗi câu hỏi là phiên mới) luôn mở session mới.
- [x] Đổi model giữa chừng: `sessionModelSwitch = "in-session"` nếu ACP cho `session/set_model`, ngược lại `"restart"` (mở session mới, giữ lịch sử bằng `transcript`). Ghi đúng giá trị `Capabilities`.
- [x] `effort` → cấu hình session (`configOptions`) hoặc `--effort`; chỉ gửi mức nằm trong `effortLevels`.
- [x] Hàng đợi: `queueing = False` ban đầu, BotTeam tự xếp tin gửi khi bot đang bận (như Codex).
- **Tiêu chí:** nhắn hai tin liên tiếp thì tin sau đợi và được trả lời sau; khởi động lại BotTeam rồi nhắn tiếp thì bot còn nhớ ngữ cảnh; đổi model giữa cuộc trò chuyện không mất lịch sử.

## 7. Ảnh và tệp

- [x] `images = True` khi `initialize` báo `promptCapabilities.image`; ảnh đi trong `session/prompt` dạng khối ảnh. Nếu không báo (một số bản chạy được dù không báo, OpenMausBot có cờ `acceptsUnadvertisedImages`), thì `images = False` và kênh nhận ảnh (Telegram/Zalo) cảnh báo "Engine của bot không đọc được ảnh" như hiện nay.
- [x] Ảnh quá lớn (trên 8 MB) hoặc không đọc được: không gửi inline mà ghi đường dẫn vào lời nhắc để agent tự mở bằng công cụ (không có thư viện thu nhỏ ảnh trong dự án, nên không thu nhỏ). Đã có test.
- **Tiêu chí:** bot kiểm kê/tra cứu chạy bằng Antigravity đọc được ảnh gửi qua Telegram, hoặc báo rõ vì sao không.

## 8. Windows: chạy ổn định (Phase 7.5)

Điều OpenMausBot đã gặp (xem `antigravity-temp.ts`, `antigravity-acp.ts`) và ta phải xử lý:

- [x] **Khởi động:** `agy` 1.5.13 là chương trình native, khởi động ~1,5 giây (đã đo); hạn khởi động 90 giây cho máy chậm, quá hạn báo "did not start in time". Không cần gia hạn theo TEMP.
- [x] **TEMP và tiến trình mồ côi:** đã đo với `agy` thật: 5 session chạy song song (5 tiến trình), `stop_all` xong còn 0 tiến trình `agy`, 0 thư mục `_MEI`, số mục trong TEMP không đổi. Vì vậy **không** làm tiến trình dùng chung hay dọn `_MEI`; xem lại nếu bản `agy` sau này đóng gói kiểu PyInstaller.
- [x] **Liên kết đăng nhập trên stderr:** dòng "Open the following link to authenticate…" được bắt từ stderr và đưa vào thông báo lỗi (`Sign in at <url> (or run agy once)`), lượt báo lỗi cài đặt thay vì treo. Đã có test.
- [x] Không bao giờ ghi hay in token; không gọi dịch vụ Google để "tra email tài khoản" (khác OpenMausBot, ta không cần hiển thị danh tính).
- **Tiêu chí:** chạy 20 lượt liên tiếp rồi tắt BotTeam: không còn tiến trình `agy` mồ côi, thư mục TEMP không phình thêm sau lần chạy thứ hai; tiến trình khởi động chậm vẫn cho lượt đầu thành công.

## 9. Giao diện, tài liệu, cài đặt (Phase 7.6)

- [x] `Welcome.tsx` `SETUP`: thêm `antigravity` (lệnh cài của Google cho Windows và macOS/Linux; đăng nhập: chạy `agy`).
- [x] `ModelMenu.tsx`, `SettingsModal.tsx`: engine mới hiện theo danh sách `instances` có sẵn (không cần sửa cấu trúc); nhãn chú thích mức duyệt cho Antigravity (mục 5); biểu tượng/ký hiệu engine.
- [x] `lib/i18n-vi.ts`: chuỗi mới (đăng nhập, đang khởi động, lỗi), chạy bài kiểm tra thiếu khóa.
- [x] `docs/user-guide.md` §3 (cấu hình engine), `README.md` (danh sách engine, ví dụ "Claude Code, Codex hoặc Antigravity"); theo quy tắc `AGENTS.md` số 3.
- [x] `install.ps1` / `install.sh`: cờ `-Antigravity` / `--antigravity` chạy bộ cài chính thức của Google (`irm https://antigravity.google/cli/install.ps1 | iex`, `curl -fsSL https://antigravity.google/cli/install.sh | bash`; `agy` vào `%LOCALAPPDATA%\agy\bin` hoặc `~/.local/bin`); script luôn dò `agy` và in cách đăng nhập. Docker không đổi.
- [x] `docs/README.md`: thêm hàng Phase 7 vào bảng.
- **Tiêu chí:** người dùng mới thấy Antigravity trong màn chào, biết cách cài và đăng nhập, rồi chọn nó khi tạo bot.

## 10. Kiểm thử

**Tự động (chạy trong CI, không cần tài khoản):**

- `tests/fake_acp.py`: tác tử giả nói ACP qua stdio (kịch bản phát lại, như `fake_composio.py`): chữ chảy dần; công cụ chạy rồi xong; công cụ xin quyền (cho phép / từ chối / không ai trả lời); `session/cancel`; `session/resume` còn và mất; `auth_required`; khởi động chậm; thoát giữa lượt; nhận `mcpServers` và ảnh; dòng rất dài.
- `tests/fake_agy.py` (giả `agy`): `--version`, `models` (đã/chưa đăng nhập), `acp`; dùng cho thử `registry` ba trạng thái.
- `test_antigravity.py`: ánh xạ sự kiện, bảng mức duyệt, `session_reset`, `effort`, đổi model, giữ bí mật trong log, dọn tiến trình khi `stop_all`, bộ giải nén TEMP (chỉ xóa thư mục có tệp đánh dấu).
- `test_registry` mở rộng: engine mới hiện đúng `state`/`signedIn`/`reason`, không làm hỏng Claude/Codex khi thiếu `agy`.
- `test_approval`: `antigravity_mode`.
- Web: kiểm i18n; hàng engine trong màn chào; `ModelMenu` liệt kê engine mới.

**Chạy tay với tài khoản thật (cổng chấp nhận của phase):** một bot Antigravity trò chuyện, sửa một file ở Ask/Edits/Full, gọi `coordinate_bots`, nhận ảnh từ Telegram, khởi động lại BotTeam rồi nhắn tiếp, Stop giữa lượt. Ghi kết quả vào `docs/verification/antigravity.md`.

## 11. Phase 7.0 — Spike (làm trước, nửa đến một ngày)

Cần **một lần đăng nhập thật** (`agy` chạy không tham số, mở trình duyệt). Trả lời và ghi lại bằng bản ghi thật (đã bỏ bí mật), rồi mới viết driver:

1. `agy acp` có sẵn có đủ dùng không, hay vẫn phải dùng `agy_acp_server` tải riêng như OpenMausBot? Phiên bản giao thức, `authMethods`, `promptCapabilities`.
2. Cách cài chính thức (Windows, macOS, Linux) và có cài không tương tác được không.
3. Chế độ in `--output-format stream-json`: dạng dòng, có `session id`, xin quyền thế nào (có hỏi qua stdin không?), MCP nạp từ đâu (`--settings`?). Dựa trên đó chốt ACP hay chế độ in; tiêu chí: gắn được MCP riêng cho từng bot **không ghi vào cấu hình toàn cục**, trả lời được yêu cầu quyền, hủy được lượt.
4. `agy models`: định dạng đầu ra; ACP `configOptions` có liệt kê model và mức suy luận không.
5. Quyền qua ACP: có `optionId` nào, "luôn cho phép trong session" lưu ở đâu.
6. Ảnh: `promptCapabilities.image` thật sự báo gì; gửi thử một ảnh.
7. Kỹ năng và thư mục `.claude/skills`: Antigravity có đọc không, hay cần `system`.
8. Một tiến trình nhiều session: có chạy song song được không, hay mỗi lượt một session tuần tự.
9. `session/resume`: dùng mã nào, khi nào mất.
10. Mức tài nguyên trên Windows: dung lượng TEMP, thời gian khởi động, thoát êm thế nào.
11. Giấy phép: nếu chép logic dọn TEMP của OpenMausBot (vốn dựa trên t3code, MIT), ghi nguồn vào `NOTICE`; viết lại bằng Python thì chỉ ghi hành vi.

**Tiêu chí ra:** một trang ghi các câu trả lời ở trên trong `docs/verification/antigravity.md`, quyết định ACP hay chế độ in, và danh sách việc đã chỉnh trong kế hoạch này.

## 12. Thứ tự và tiêu chí hoàn thành

| Bước | Nội dung | Xong khi |
|---|---|---|
| 7.0 | Spike với tài khoản thật (mục 11) | Có `docs/verification/antigravity.md` và quyết định giao thức |
| 7.1 | Dò engine, đăng nhập, model (mục 3) | Ba trạng thái hiện đúng trong UI |
| 7.2 | Client ACP + driver (mục 4) | Chat, công cụ, Stop, lỗi đúng với tác tử giả |
| 7.3 | Duyệt quyền, bridge đội, MCP riêng (mục 5) | Bảng bốn mức đúng; `coordinate_bots` chạy |
| 7.4 | Tiếp tục, hàng đợi, model, suy luận, ảnh (mục 6, 7) | Nhớ ngữ cảnh sau khởi động lại; nhận ảnh |
| 7.5 | Windows ổn định (mục 8) | Không tiến trình mồ côi, TEMP không phình |
| 7.6 | UI, tài liệu, cài đặt, i18n (mục 9) | Người mới cài và chọn được; test xanh |

Cả phase xong khi: các bước trên đạt, toàn bộ test server và web đạt, chạy tay mục 10 thành công, và `README.md`, `install.ps1`, `install.sh` đã rà theo quy tắc `AGENTS.md`.

## 13. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| Giao thức/cờ của `agy` đổi theo phiên bản (đang ở 1.5.x) | Ghi phiên bản đã kiểm trong `verification`; client ACP chịu được trường lạ; hiện cảnh báo khi phiên bản ngoài khoảng đã thử |
| Cần đăng nhập thật để kiểm, CI không có | Toàn bộ logic kiểm bằng tác tử giả; phần thật là cổng chạy tay, không chặn CI |
| Windows: giải nén lớn vào TEMP, khởi động chậm, tiến trình mồ côi | Một tiến trình dùng chung, TEMP riêng, thoát êm, dọn có điều kiện (mục 8) |
| Quyền: tác tử có công cụ riêng bỏ qua broker | Chỉ cho `--dangerously-skip-permissions` ở mức Full; ở mức khác mọi yêu cầu quyền đi qua broker, không có yêu cầu thì ghi rõ giới hạn trong tài liệu mức duyệt |
| MCP cấu hình toàn cục lẫn giữa các bot (`agy mcp add`) | Chỉ truyền MCP theo từng session; không bao giờ gọi `agy mcp add` |
| Bí mật rò qua log, tham số, URL đăng nhập | Bỏ bí mật khỏi log/stderr; liên kết đăng nhập chỉ hiện cho người dùng, không lưu; không ghi token |
| Hai bản `agy` (CLI có sẵn và `agy_acp_server` tải riêng) | Ưu tiên `agy acp` có sẵn; chỉ khi spike cho thấy nó không đủ mới cân nhắc tải riêng (cần ghim SHA-256 như OpenMausBot) |

## 14. Ngoài phạm vi

- Chạy từ xa (`--remote-agent`, `--remote-control`), micro (`mic-serve`), cửa hàng plugin của Antigravity, dự án đám mây (`--project`, `--new-project`).
- Ép đầu ra theo `--json-schema`.
- Hiển thị tài khoản/email Google của người dùng.
- Cài `agy` bên trong ảnh Docker.
- Engine ACP khác (Gemini CLI, Qwen Code, OpenCode…): client `drivers/acp.py` viết tổng quát để sau này thêm được, nhưng phase này chỉ làm Antigravity.

## 15. Kết quả triển khai và chỗ khác kế hoạch

Đã làm: `drivers/antigravity.py` (driver + client ACP nhỏ), `antigravity_mode()` trong `approval.py`, dò engine ở `registry.py`, giao diện (Welcome, Settings, i18n), install script, README và user-guide, `tests/fake_acp.py` + `tests/test_antigravity.py` (driver, mức duyệt, MCP, ảnh, Stop, tiến trình chết, ba trạng thái dò engine).

Khác kế hoạch, do kiểm thật (chi tiết ở các mục trên): client ACP nằm trong `antigravity.py`; một tiến trình mỗi thread và không cần dọn TEMP (đã đo); `steer` giữ `refused` vì đã đo: `agy` chỉ xếp hàng tin thứ hai chứ không điều hướng lượt đang chạy, và kết quả lượt đầu đến sớm (xem verification); ảnh lớn đi bằng đường dẫn; install script có cờ `-Antigravity` / `--antigravity` (bộ cài chính thức của Google).

Đã kiểm với `agy` thật: chat, resume, quyền Ask, Edits (ghi file không hỏi, lệnh chỉ-đọc broker tự duyệt), Full, MCP bridge, ảnh, Stop, và 5 session liên tiếp không để lại tiến trình hay thư mục tạm (`docs/verification/antigravity.md`). Test tự động: 23 test Antigravity, 382 pass trong bộ test server đầy đủ; một test (`test_memory::test_a_compaction_is_marked_in_the_chat`) timeout khi dựng fixture trong lần chạy dài và pass khi chạy riêng. Danh sách `agy models` giờ được nhớ 2 phút trong tiến trình để các lần dò không gọi mạng lặp lại.
