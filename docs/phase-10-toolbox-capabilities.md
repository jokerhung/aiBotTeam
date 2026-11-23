# Phase 10 — Toolbox: Subagents, Web use, Computer use

**Mục tiêu:** tab **Toolbox** của trang sửa Agent (Phase 9) có ba khả năng bật/tắt được cho từng agent, mỗi khả năng là một thẻ có công tắc và hộp cài đặt riêng, giống Toolbox của agenticos:

1. **Subagents** (`subagents`) — agent giao một phần việc cho agent khác và dùng câu trả lời của nó (nhóm "Thinking and planning"). Làm **giống Subagents của agenticos** để dựng được một đội như aiSocialTeam (Master + Research, Creator, Scheduler, Analytics): danh sách delegate, specialist viết ngay trong agent mẹ, specialist do model tự tạo, chế độ chờ hoặc không chờ, và mẫu đội dựng sẵn.
2. **Web use** (thẻ "Web browser", `browser_use`) — agent duyệt web bằng trình duyệt thật (Edge/Chrome), người dùng xem trực tiếp và Take over khi cần (nhóm "The web").
3. **Computer use** (`computer_use`) — agent điều khiển một máy tính ảo có màn hình đầy đủ (nhìn ảnh, bấm, gõ) (cũng ở nhóm "The web", đúng như ứng dụng tham chiếu).

Ba thẻ này **đã có trong danh mục Toolbox** (`web/components/agents/toolbox/catalog.ts`, chép nhãn từ agenticos 1.89.1) nhưng chưa có hành vi: công tắc chưa làm gì. Phase này làm cho chúng hoạt động thật.

**Trạng thái:** kế hoạch, chưa có mã. Đã chốt bảy quyết định của người dùng (mục 8): thay hẳn công cụ trình duyệt cũ bằng Web use mới; Computer use hỗ trợ cả E2B và OpenSandbox; mặc định **Subagents tắt, Web use bật, Computer use tắt** (riêng **các bot đang phối hợp được tự bật Subagents khi nâng cấp**); không kiểm soát chi phí (các engine chạy qua CLI); delegate dùng cấu hình hiện tại của bot (không ghim phiên bản); không làm A2A; phụ thuộc Computer use là tùy chọn.

**Tham chiếu**

- Mã đã làm ở dự án anh em `D:\hungnm\github\aiSocialTeam` (cùng nền BotTeam): Web use ở `server/botteam/browser_host.py`, `browser_egress.py`, `browser_mcp.py`, `docs/phase-9-browser-use.md`; Computer use ở `computer_host.py`, `computer_provider.py`, `computer_opensandbox.py`, `computer_mcp.py`, `computer_settings.py`, `computer_stream.py`, `docs/phase-10-computer-use-e2b-embed.md`, `docs/phase-11-computer-provider-opensandbox.md`, `docs/e2b-setup.*`, `docs/opensandbox-*`, `docs/opensandbox-desktop/`; giao diện ở `web/components/browser/*` và `web/components/guides/setup-guide.tsx`; test ở `server/tests/test_browser*.py`, `test_computer_*.py`.
- agenticos: Toolbox ("Capabilities") và Delegation (`docs/reference/capabilities.md#delegation`, `docs/concepts.md#delegate-vs-inline-specialist`, `docs/howto/specialist-team.md`); nhãn trên giao diện là **Subagents**, tài liệu gọi là Delegation.
- BotTeam hiện tại: `server/botteam/agents.py` (công cụ đội: `list_bots`, `coordinate_bots`, `assignment_status`…), `runtime.py` (bản ghi việc giao giữa các bot, `MAX_DEPTH`, ngân sách), `browser.py` (`BrowserService`, bộ công cụ `browser_*` tự viết), `mcp_bridge.py`, `turns.py`, `web/components/ComputerPanel.tsx`, `docs/phase-9-agents-page.md` (trang sửa Agent và tab Toolbox).
- Quy tắc dự án `AGENTS.md`: tham khảo ứng dụng tham chiếu, rà `README.md`, `install.ps1`, `install.sh` trước khi push.

**Phụ thuộc:** tab Toolbox và biểu mẫu có nút Save của Phase 9. Khi lập kế hoạch này, cây làm việc đã có bản làm dở của Phase 9 chưa commit (`web/components/agents/`, `toolbox/catalog.ts`, `Toolbox.tsx`); phase này bám theo danh mục và các thẻ đó (id `subagents`, `browser_use`, `computer_use`). Phase 9 phải commit trước khi bắt đầu 10.1.

## 1. Hiện trạng

| | BotTeam | aiSocialTeam (đã có) | agenticos |
|---|---|---|---|
| Giao việc giữa agent | Có sẵn và khá mạnh: `coordinate_bots` giao việc bất đồng bộ, bot được đánh thức khi có kết quả; bản ghi việc ở `runtime.py` (độ sâu tối đa 3, ngân sách yêu cầu/lượt chạy/lần đánh thức, phạm vi của Chief of Staff). **Không** có cấu hình theo từng agent: bot nào cũng có công cụ này | như BotTeam | Subagents: danh sách delegate ghim phiên bản, chế độ sync/async/auto, giới hạn độ sâu, số việc chạy cùng lúc, độ dài kết quả |
| Duyệt web | Trình duyệt Playwright riêng mỗi bot, bộ công cụ `browser_*` tự viết, luôn có; có Computer panel xem trực tiếp và Take over | Đã thay bằng `BrowserHost` (Edge/Chrome thật, CDP) + **Playwright MCP** + cổng SOCKS5 chặn địa chỉ nội bộ + Take over/Hand back + công tắc "hiện cửa sổ" | Browser (Mirage, Web browser, Read web pages) |
| Điều khiển máy tính | Không có | E2B (Cloud hoặc tự host) và **OpenSandbox (Docker)** qua lớp `ComputerProvider`; MCP `computer`; luồng noVNC qua server; Take over; khoá cho tới khi máy chủ Computer `ready` | Computer use (có quyền) |
| Bật/tắt theo agent | Không (trừ `memory`, `skills`, `mcpServers`) | Có cài đặt "giao diện" theo agent: `browser` / `computer` / `off` | Có, mỗi khả năng một công tắc |

## 2. Mô hình Toolbox

- **Trường mới trên bot:** `toolbox` (JSON), ví dụ
  `{"subagents": {"enabled": false, "allowAnyAgent": false, "delegates": [{"bot": "bot_x", "handBack": null}], "inline": [], "allowDynamic": false, "mode": "async", "allowQuestions": false, "maxDepth": 2, "maxFanout": 3, "maxResultChars": 4000, "shareWithDelegates": []}, "web": {"enabled": true, "headed": false}, "computer": {"enabled": false, "resolution": [1280, 800], "idleSeconds": 600, "allowCommands": false}}`. Bot lưu dạng JSON nên không cần đổi lược đồ.
- **Mặc định (đã chốt):** bot **mới** và bot nhập từ tệp (không có `toolbox`) có **Subagents tắt, Web use bật, Computer use tắt**.
- **Di chuyển một lần khi nâng cấp (đã chốt): các bot đang phối hợp tự được bật Subagents**, để đội đang chạy không mất khả năng giao việc. Một bot cũ (chưa có `toolbox`) được coi là *đang phối hợp* nếu thỏa **một** trong các điều kiện:
  1. là **Chief of Staff** (`chief`) hoặc quản lý nhóm (`managedSections` không rỗng);
  2. có **"Reports to"** (`reportsTo`), hoặc là người được bot khác chọn trong "Reports to";
  3. đã **giao hoặc nhận việc** giữa các bot trước đây (có dòng trong `assignments` của `runtime.db` với bot đó là bên giao hoặc bên nhận).
  Bot không thỏa điều kiện nào được ghi `subagents.enabled = false`. Bot đang bật mặc định `delegates = all` (mọi bot trong đội) và `allowAnyAgent = true` để hành vi giao việc **giữ như trước khi nâng cấp**; người dùng có thể thu hẹp danh sách sau. Di chuyển **chỉ chạy một lần** (cờ `toolboxMigrated` trong cấu hình), **không bao giờ ghi đè** `toolbox` đã có, và sao lưu cấu hình bot trước khi chạy (`backup`). Sau khi chạy, một thông báo một lần liệt kê bot nào đã được bật Subagents (và nút đi tới trang Agents), kèm dòng trong "What's new".
- Web use bật cho mọi bot, nhưng đổi từ bộ công cụ cũ sang Playwright MCP (mục 4).
- **Khả năng có sẵn trong Claude Code và Codex** (đã làm): thẻ nào mà **cả hai** CLI tự làm được (Calculations, Coding agent, Sandbox, Work while tools run, Web search, Skills, Connected apps, Long conversations, Date and time) luôn **bật và không tắt được** với agent chạy trên hai engine đó; danh sách và bằng chứng ở `docs/verification/toolbox-native.md`, mã ở `web/components/agents/toolbox/native.ts`. BotTeam bật `web_search` cho Codex khi khởi động app-server (mặc định của CLI là tắt).
- **Cưỡng chế thật, không chỉ hiển thị:** `turns.py` chỉ gắn công cụ khi khả năng bật: công cụ đội (`coordinate_bots`, `assignment_status`) theo `subagents`, MCP Playwright theo `web`, MCP `computer` theo `computer`. `mcp_bridge` lọc danh sách công cụ theo biến môi trường của lượt (`BT_TOOLS`), và gọi công cụ đã tắt bị từ chối ở phía server (không tin phía engine). Đổi công tắc có hiệu lực từ lượt kế tiếp.
- **Hướng dẫn trong lời nhắc:** mỗi khả năng bật thêm một đoạn ngắn vào lời giới thiệu bot (danh sách delegate, quy trình nhìn–làm–kiểm tra của Computer, gọi xin giúp ở đăng nhập/CAPTCHA…), bỏ đoạn của khả năng tắt: điều model đọc phải đúng với điều sẽ xảy ra.
- **Giao diện:** ba thẻ đã có trong Toolbox (xem trên), nay mỗi thẻ có công tắc thật và nút cài đặt mở hộp thoại riêng; công tắc đi qua nút **Save** của trang sửa (Phase 9) như các trường khác của agent. Thẻ Computer use **bị khoá** (kèm lý do) cho tới khi máy chủ Computer ở trạng thái sẵn sàng (xem 5).
- **Cài đặt toàn cục** (không theo agent) nằm ở Settings: **Computer host** (nhà cung cấp, khoá, kiểm tra kết nối). Web use chỉ có cài đặt theo agent (và biến môi trường chọn trình duyệt).

## 3. Subagents (làm giống agenticos)

BotTeam đã có lõi của việc giao việc (`coordinate_bots`, `runtime.py`: bản ghi việc, đánh thức khi có kết quả, độ sâu, ngân sách). Phần còn thiếu so với agenticos là **cấu hình theo agent, specialist, chế độ chờ và mẫu đội**. Hộp thoại **Subagents settings** (mở từ biểu tượng cài đặt của thẻ) có các khối giống agenticos 1.89.1:

### 3.1 Các khối của hộp thoại

| Khối | agenticos | Làm trong BotTeam |
|---|---|---|
| **Tools / All accessible agents** | Công tắc cho gọi mọi agent người dùng được phép chạy; routine chạy không người trông **chỉ dùng delegate khai báo rõ** | `allowAnyAgent`: mọi bot trong đội (trừ chính nó và tổ tiên trong cây giao việc). Routine, webhook và kênh nhận tin (Telegram, Zalo) **chỉ dùng delegate khai báo rõ** |
| **Delegates** (Add a delegate) | Agent đã Publish, **ghim phiên bản**, có dòng "lỗi thời" | Chọn các bot khác làm delegate; mỗi dòng: tên, title, mô tả, model, nút xóa, và ô **When it hands back** riêng (Follow the policy / Wait for the answer / Keep working). **Không có ghim phiên bản (đã chốt)**: BotTeam không có Publish, delegate dùng cấu hình hiện tại của bot; giao diện ghi rõ "uses the bot's current setup" |
| **Inline specialists** (Add a specialist) | Chuyên gia viết ngay trong agent mẹ, không có phiên bản, đổi theo agent mẹ | Mục 3.3 |
| **Remote agents (A2A)** | Agent của hãng khác qua agent card | **Ngoài phạm vi** (mục 9); khối này hiện "Soon" |
| **Settings** | `mode`, `allow_questions`, `allow_dynamic`, `max_depth`, `max_fanout`, `max_result_chars`, `share_with_delegates` | Mục 3.2 |

### 3.2 Các cài đặt và ngữ nghĩa

| Cài đặt | Giá trị | Ngữ nghĩa trong BotTeam |
|---|---|---|
| Mode | `sync` (chờ), `async` (giao rồi chạy tiếp), `auto` (model chọn) | **Do cấu hình quyết định, không do model**, như agenticos (cấu hình được duyệt, nên thắng). Mỗi delegate có thể ghi đè; lời nhắc đánh dấu delegate ghi đè để điều model đọc đúng điều sẽ xảy ra |
| Allow questions | bật/tắt | Delegate chạy `sync` được hỏi lại người dùng của agent mẹ (đã có `consult` và `needs_input`); specialist do model tự tạo không bao giờ được hỏi |
| Allow dynamic | bật/tắt | Cho model tự tạo specialist một lần (mục 3.4); mặc định tắt |
| Max depth | 1–3 (mặc định 2) | Số tầng giao việc kể cả tầng của chính agent đó; hiện là hằng `MAX_DEPTH = 3`; mỗi agent trong cây chịu giới hạn của riêng nó (lấy giá trị thấp hơn của phần còn lại và giới hạn riêng); tới giới hạn thì delegate **không được cấp công cụ giao việc** thay vì cấp công cụ chỉ biết từ chối |
| Max fan-out | 1–10 (mặc định 3) | Số việc chạy nền cùng lúc; vượt thì trả kết quả công cụ để model chờ hoặc tự làm, không làm hỏng lượt chạy |
| Max result length | 500–20000 ký tự | Cắt kết quả trả về agent mẹ |
| Share with delegates | danh sách khả năng | Specialist **không có khả năng nào của riêng nó trừ khi agent mẹ chia sẻ**: chỉ chia sẻ được khả năng mà chính agent mẹ đang bật (Web use, Computer use, Memory…) |

**Hai chế độ chờ.** BotTeam hiện chỉ có kiểu *giao rồi kết thúc lượt, được đánh thức khi có kết quả* (`reply: resume`). Để có `sync` như agenticos, thêm công cụ **`task(bot, description)`**: tạo việc, **chờ trong cùng lượt** tới khi việc xong rồi trả câu trả lời cho agent mẹ (có hạn chờ `maxWaitSeconds`, mặc định 300 giây; hết hạn thì chuyển thành việc không chờ và báo cho model). Cần kiểm engine nào chịu được lời gọi công cụ chờ lâu (Claude Code, Codex, Antigravity) ở bước 10.2. `async` giữ `coordinate_bots`/`wait` hiện có. Công cụ theo dõi việc chạy nền (`assignment_status`, hủy) chỉ cấp khi chế độ cho phép chạy nền, để model không phải trả chi phí mô tả công cụ vô dụng mỗi lượt.

### 3.3 Specialist viết ngay trong agent mẹ (inline)

- Mỗi specialist có: **Name**, **Max steps**, **Description** (câu mà model của agent mẹ đọc để quyết định có giao việc hay không: "highest-leverage sentence"), **Instructions**, **Model**, **When it hands back**, **What it can do** (danh sách khả năng bật cho riêng nó), **Knowledge it may search**, **Skills it may read**.
- **Cách chạy trong BotTeam:** lưu trong `toolbox.subagents.inline[]` của agent mẹ và được **hiện thực thành một bot ẩn** (`hidden: true`, `owner: <bot mẹ>`, `inline: true`) tạo và cập nhật khi lưu agent mẹ. Nhờ vậy `runtime.py`, `turns.py`, quyền, chi phí và chat dùng nguyên cơ chế hiện có; không hiện ở danh sách chat, Agents hay menu; xóa khỏi danh sách thì xóa bot ẩn. Chi phí không được cộng vào agent mẹ (mục 3.5).
- **Promote:** nút "Promote to agent" bỏ `hidden` và `inline`, thành một agent thường (không publish, không ghim, không xóa khỏi danh sách của mẹ: mỗi quyết định kế tiếp là việc của người dùng).
- Specialist **không giao việc tiếp** (một cấp, như agenticos).

### 3.4 Specialist do model tự tạo (dynamic) — khi `allowDynamic` bật

- Hai công cụ `create_agent` và `delegate`: model tạo một bot ẩn tạm (`ephemeral: true`) với instructions, model và khả năng chia sẻ từ agent mẹ, giao việc ngay, và **xóa khi lượt chạy gốc kết thúc** trừ khi người dùng bấm Promote ngay trên thẻ giao việc trong chat (khoảng thời gian duy nhất mà định nghĩa còn đọc được).
- Mặc định **cần duyệt**: mỗi `delegate` hiện thẻ duyệt với instructions model viết, người dùng đọc rồi mới cho chạy ("Always ask"); ở mức Full thì không hỏi nhưng vẫn bị `maxFanout` và `maxDepth`.
- Specialist tự tạo **không bao giờ được hỏi người dùng** và **không có công cụ nào trừ khi agent mẹ chia sẻ**, nên công thức nghiên cứu sâu (ba phần câu hỏi, ba specialist chạy song song, chờ đủ rồi mới viết báo cáo) chạy được khi mẹ bật Web use và chia sẻ cho delegate.

### 3.5 Ghi nhận và giám sát

- Mỗi việc giao là một lượt chạy con có `parentAssignment` và `rootAssignment`, dùng để hiện cây giao việc trong chat và Activity.
- **Chi phí không được kiểm soát ở phase này (đã chốt):** các engine chạy qua CLI (Claude Code, Codex, Antigravity) nên BotTeam không đặt ngân sách theo agent hay chặn theo chi phí; không có sổ chi tiêu chung và không cộng chi phí delegate vào agent mẹ. Trang Usage tiếp tục hiện chi phí và token **riêng từng bot** như hiện nay. Giới hạn **độ sâu, fan-out và hạn chờ** (mục 3.2) vẫn là các chốt chặn giao việc lan rộng.
- Thẻ trong chat "Handed work to <bot>" giữ như hiện nay; thẻ duyệt hiện rõ **delegate nào** đề nghị (đã có `by`); duyệt xong thì delegate tiếp tục đúng chỗ dừng, không giao lại từ đầu.
- Công cụ đội ẩn hẳn khi `subagents` tắt; `list_bots` chỉ trả các delegate được phép (cộng bot cùng nhóm nếu `allowAnyAgent`).

### 3.6 Dựng một đội như aiSocialTeam

Để "tạo một đội như aiSocialTeam" chỉ bằng vài thao tác:

- **Team templates:** trong thư viện **Agent templates** (Phase 9) thêm mục **Teams**; mẫu đầu tiên **Social media team** tạo **5 agent** (Master, Research, Creator, Scheduler, Analytics) từ soul của aiSocialTeam (`social.py`, `TEAM`) đã bỏ phần gọi HTTP của trang Posts, đặt Description ngắn cho từng agent, bật khả năng phù hợp (Research: Web use; Creator: Memory và Skills; Master: Subagents), và **nối Master với 4 delegate** ở `async`, fan-out 4. Cài xong mở trang sửa của Master.
- **Duplicate team:** menu của Master có **Duplicate with delegates**: nhân bản Master và các delegate rồi nối lại cho đúng bản sao, để mỗi chiến dịch một đội.
- **Chủ đề mẫu khác** (về sau): Support desk (front desk + billing + technical, theo công thức "specialist team" của agenticos), Deep research.

## 4. Web use (tham khảo aiSocialTeam Phase 9)

**Quyết định:** chuyển sang kiến trúc đã chạy ổn ở aiSocialTeam, thay bộ công cụ `browser_*` tự viết:

- **`BrowserHost`**: mỗi bot một trình duyệt thật (Edge, rồi Chrome, rồi Chromium của Playwright; `BOTTEAM_BROWSER_CHANNEL` ghi đè), hồ sơ riêng `<data>/browser/<bot>/` giữ đăng nhập, cổng CDP chỉ nghe `127.0.0.1`, tắt khi rảnh, không để tiến trình mồ côi (`kill_tree`). Mặc định không hiện cửa sổ (headless mới); công tắc **Show browser window** (headed) cho trang chặn headless.
- **Playwright MCP** (`@playwright/mcp`, **phiên bản cố định** như aiSocialTeam, 0.0.86) nối vào trình duyệt đó qua CDP, đi qua `mcp_proxy` để áp ngân sách đầu ra và bộ lọc quyền. Bộ công cụ chuẩn (snapshot theo cây trợ năng, điều hướng, tab, tải tệp, hộp thoại…) mà Claude Code, Codex và Antigravity đều biết dùng.
- **`BrowserEgress`**: cổng SOCKS5 loopback chặn mọi đích nội bộ (loopback, mạng riêng, link-local), kiểm tra địa chỉ IP đã phân giải, áp dụng cả khi đổi hướng và tải tài nguyên phụ; có cờ cho phép địa chỉ nội bộ khi người dùng muốn (như `netguard` hiện nay). Không dựa vào `--allowed-origins` của Playwright MCP vì chính nó ghi không phải ranh giới bảo mật.
- **Take over / Hand back** và **`browser_request_help(reason)`** (do BotTeam cung cấp): bot gặp đăng nhập, CAPTCHA hay xác minh thì xin giúp và chờ; khi người đang điều khiển, mọi lệnh Playwright MCP bị từ chối.
- **Xem trực tiếp:** luồng ảnh `Page.startScreencast` qua SSE; công cụ có tác dụng phụ (bấm, gõ, gửi) theo mức duyệt của bot qua permission broker, giống hiện nay.
- **Giữ từ BotTeam:** Computer panel hiện có (đổi tên thành **Browser** khi bot dùng Web use), API `/api/bots/{id}/browser/*` (giữ `/computer/*` làm bí danh một thời gian), sự kiện `browser-control`.
- **Bỏ phần riêng của mạng xã hội** khi chép từ aiSocialTeam: `COMPOSE_PATHS`, chính sách "đăng bài bằng Composio hay Web", soul của các vai Research/Creator.
- **Cài đặt của thẻ Web use:** công tắc, **Show browser window**, **Allow local addresses** (mặc định tắt), thời gian rảnh trước khi tắt trình duyệt, nút **Reset browser profile** (mất đăng nhập, có xác nhận).
- **Yêu cầu máy:** Node.js (đã là điều kiện cài của BotTeam) để chạy `npx @playwright/mcp`, và Edge hoặc Chrome (đã có trong `install.*`); thiếu thì thẻ báo lý do và gợi ý cài.

## 5. Computer use (tham khảo aiSocialTeam Phase 10 và 11)

- **`ComputerProvider`** với hai nhà cung cấp: **E2B** (Cloud hoặc tự host Embed) và **OpenSandbox** (Docker, nhẹ hơn, không cần KVM). Một nhà cung cấp cho toàn bộ Computer use, chọn ở cài đặt toàn cục. Khả năng khác nhau được khai báo (`pause`, `egressPolicy`, `secureIsolation`, `persistentLogin`) và giao diện nói đúng điều đó.
- **`ComputerHost`**: vòng đời máy ảo mỗi bot (tạo khi dùng lần đầu, tạm dừng khi rảnh, tiếp tục, huỷ), khoá `control` (`agent` | `person`), kiểm tra kết nối (kể cả kiểm tra sâu cho OpenSandbox), giữ màn hình không tắt.
- **MCP `computer`** (Python stdio, qua `mcp_proxy`): `computer_screenshot`, `click` (trái/phải/đôi), `move`, `drag`, `scroll`, `type`, `key`, `launch`, `wait`, `read_file`, `write_file`, `run_command`. Công cụ có tác dụng phụ theo mức duyệt của bot; `run_command` mặc định chỉ ở mức Full hoặc phải bật **Allow commands** trong thẻ.
- **Xem trực tiếp:** luồng noVNC chỉ xem đi qua **server BotTeam làm trung gian** (không phơi cổng của nhà cung cấp, không lộ khoá); **Take over** chuyển sang điều khiển; **Hand back** trả lại.
- **Bảo mật:** máy ảo cô lập; tường lửa ra ngoài bắt buộc chặn mạng riêng và địa chỉ của chính BotTeam (`PRIVATE_NETWORKS`); nội dung trên màn hình là dữ liệu không đáng tin (bot không làm theo lệnh nằm trong ảnh, không nhập mật khẩu, xin người dùng làm qua Take over); khoá API chỉ lưu phía server và không trả lại; đăng nhập trong máy ảo không vào sao lưu hay file xuất bot.
- **Điều kiện engine và model:** engine phải nhận ảnh trong kết quả công cụ MCP và model phải nhìn được ảnh. Phải kiểm từng engine (Claude Code, Codex, Antigravity) ở bước 10.5; engine hoặc model không nhận ảnh thì thẻ Computer use bị khoá kèm lý do. (Antigravity đã nhận ảnh trong prompt; ảnh trong kết quả công cụ chưa kiểm.)
- **Cài đặt toàn cục** (Settings → mục Computer): nhà cung cấp, khoá API (chỉ ghi), địa chỉ máy chủ, mẫu hoặc image, số máy tối đa, thời gian rảnh, **Test connection** với trạng thái `ready` | `unreachable` | `unauthorized` | `no_template` | `no_image` | `no_egress_policy`.
- **Cài đặt của thẻ Computer use:** công tắc (khoá cho tới khi host `ready`), độ phân giải (mặc định 1280×800), thời gian rảnh, **Allow commands** (mặc định tắt), nút **Delete machine** (mất đăng nhập).
- **Tệp hướng dẫn tự thiết lập** (người dùng tự làm, không có mã cài trong dự án): `docs/e2b-setup.{vi,en}.md`, `docs/opensandbox-setup.{vi,en}.md`, `docs/opensandbox-desktop/` (Dockerfile của image desktop), và trang hướng dẫn trong giao diện đọc các tệp đó.
- **Phụ thuộc Python** (`e2b-desktop`, `opensandbox`): đặt là **tuỳ chọn** (nhóm `computer` trong `pyproject.toml`) thay vì bắt buộc như aiSocialTeam, để cài đặt mặc định của BotTeam không nặng thêm; thiếu thì thẻ báo "cài thêm gói" kèm lệnh.

## 6. Giao diện

- **Toolbox:** các thẻ Subagents (nhóm "Thinking and planning"), Web browser và Computer use (cùng nhóm "The web") cùng kiểu thẻ với Memory, Skills, Connected apps của Phase 9: tên, mô tả một dòng, số công cụ, công tắc, nút cài đặt, nhãn "Recommended" cho Subagents và Web use, biểu tượng khoá và lý do cho Computer use khi chưa sẵn sàng.
- **Panel chat (Computer panel):** hiện tab **Browser** (Web use, luồng CDP) hoặc **Computer** (noVNC) theo khả năng bật của bot; nếu cả hai tắt thì không có tab. Có nút Take over, Hand back, thẻ "Agent cần bạn" như hiện nay.
- **Hộp thoại Subagents settings:** các khối ở mục 3.1 xếp dọc (Tools, Delegates, Remote agents "Soon", Inline specialists, Settings); mỗi specialist là một thẻ gập có đủ các trường ở mục 3.3; thẻ delegate có chỉ báo đang chạy và nút mở cuộc trò chuyện của nó.
- **Chat:** thẻ giao việc, thẻ duyệt có tên delegate, nút Promote trên thẻ giao việc của specialist tự tạo.
- **Từ ngữ:** "Agent" như đã chốt ở Phase 9; chuỗi mới có bản Việt (`i18n-vi.ts`).

## 7. Các bước

### 10.0 Chuẩn bị
- [ ] Đọc lại và liệt kê tệp cần chép từ aiSocialTeam (mục tham chiếu), bỏ phần mạng xã hội; ghi vào `docs/verification/toolbox-port.md`.
- [x] Chốt các câu hỏi: người dùng đã trả lời cả bảy (mục 8).
- [ ] Kiểm tay: Playwright MCP và `@playwright/mcp` chạy được trên máy này; Edge/Chrome có sẵn.

### 10.1 Mô hình Toolbox và cưỡng chế
- [ ] Trường `toolbox` trên bot (bot mới: Subagents tắt, Web use bật, Computer use tắt), `PATCH /api/bots/{id}` nhận và kiểm tra `toolbox`. **Di chuyển một lần** (mục 2): bot đang phối hợp (Chief of Staff, có "Reports to" hoặc được chọn ở đó, hoặc từng giao/nhận việc) được ghi Subagents bật với delegate là cả đội; cờ `toolboxMigrated`, sao lưu trước khi chạy, không ghi đè `toolbox` có sẵn; thông báo một lần liệt kê các bot đã bật và dòng trong "What's new".
- [ ] `turns.py` và `mcp_bridge.py`: gắn và lọc công cụ theo `toolbox`; server từ chối gọi công cụ đã tắt (test cho từng khả năng).
- [ ] Khung Toolbox ở trang sửa Agent (nếu Phase 9 chưa có): lưới thẻ có công tắc qua nút Save.
- **Tiêu chí:** tắt Subagents thì bot không thấy `coordinate_bots`; tắt Web use thì không có công cụ trình duyệt; bot không phối hợp có Web use bật và Subagents tắt; bot đang phối hợp có Subagents bật sau khi nâng cấp; bật lại thì công cụ có ở lượt kế.

### 10.2 Subagents (giống agenticos)
- [ ] **Cấu hình và cưỡng chế:** hộp thoại Subagents settings (Tools, Delegates có ô When it hands back, Settings); `allowAnyAgent`, `delegates`, độ sâu theo agent (công cụ giao việc không cấp ở tầng cuối), fan-out, độ dài kết quả; routine, webhook và kênh nhận tin chỉ dùng delegate khai báo rõ; `list_bots` và `coordinate_bots` kiểm danh sách; lời nhắc liệt kê delegate và đánh dấu delegate ghi đè chế độ.
- [ ] **Chế độ `sync`:** công cụ `task(bot, description)` chờ trong cùng lượt (hạn `maxWaitSeconds`); kiểm từng engine với lời gọi công cụ chờ lâu; `auto` do cấu hình quyết định.
- [ ] **Allow questions** (delegate `sync` hỏi lại người dùng của agent mẹ qua `consult`).
- [ ] **Inline specialists:** các trường ở mục 3.3, hiện thực thành bot ẩn (`owner`, `inline`), đồng bộ khi lưu agent mẹ, Promote, **Share with delegates** (chỉ chia sẻ khả năng mẹ đang bật).
- [ ] **Dynamic specialists** (`allowDynamic`): `create_agent` và `delegate`, bot ẩn tạm xóa khi lượt gốc xong, thẻ duyệt hiện instructions, Promote trên thẻ giao việc.
- [ ] **Giám sát:** `parentAssignment`/`rootAssignment` để hiện cây giao việc; thẻ duyệt có tên delegate và tiếp tục đúng chỗ dừng. Không làm sổ chi phí chung (đã chốt).
- [ ] **Team templates:** mục Teams trong Agent templates với **Social media team** (5 agent nối sẵn), **Duplicate with delegates**.
- **Tiêu chí:** cài mẫu Social media team, nhờ Master "lên kế hoạch tuần này cho chiến dịch X": Master giao Research và Creator song song, chờ đủ rồi tổng hợp, Scheduler và Analytics được giao đúng việc; routine chỉ gọi được delegate khai báo; vượt fan-out hoặc độ sâu cho lý do rõ ràng, lượt chạy không hỏng; đội "Leader, Developer, Tester" hiện có **vẫn phối hợp như trước sau khi nâng cấp** mà không phải bật gì (Leader là Chief of Staff nên được tự bật); tắt Subagents của Leader thì Leader không còn thấy công cụ giao việc.

### 10.3 Web use
- [ ] Chép và chỉnh `browser_host.py`, `browser_egress.py`, `browser_mcp.py` (bỏ phần mạng xã hội), thêm vào `drivers`-style tests; nối `mcp_proxy`.
- [ ] API `/api/bots/{id}/browser/*` (+ bí danh `/computer/*`), sự kiện `browser-control`, luồng ảnh CDP.
- [ ] Bỏ `BrowserService` và bộ công cụ `browser_*` cũ cùng test của chúng; viết lại test cho `BrowserHost`.
- [ ] Thẻ Web use và hộp thoại cài đặt; tab Browser trong panel chat; chuỗi Việt.
- **Tiêu chí:** bot mở một trang, đọc, bấm; gặp CAPTCHA thì xin giúp và chờ; Take over rồi Hand back chạy đúng; truy cập `127.0.0.1` và mạng riêng bị chặn mặc định; không còn tiến trình trình duyệt sau khi tắt server.

### 10.4 Computer use: host và nhà cung cấp
- [ ] Chép `computer_provider.py`, `computer_host.py`, `computer_settings.py`, `computer_stream.py`, `computer_opensandbox.py`; bỏ phần gắn chặt với mạng xã hội; phụ thuộc tuỳ chọn.
- [ ] API `/api/computer/host` (+ test kết nối), `/api/bots/{id}/computer/*` (wake, sleep, control, input, stream, screen).
- [ ] Cài đặt toàn cục (Settings → Computer) và trang hướng dẫn tự thiết lập; chép `docs/e2b-setup.*`, `docs/opensandbox-*`, `docs/opensandbox-desktop/` và chỉnh cho BotTeam.
- **Tiêu chí:** kết nối thử báo đúng từng trạng thái; tạo, tạm dừng, tiếp tục, huỷ một máy; luồng hình xem được qua server; Take over bấm và gõ được.

### 10.5 Computer use: công cụ cho agent
- [ ] `computer_mcp.py` (MCP `computer`) qua `mcp_proxy`, quyền theo mức duyệt, kiểm toạ độ, giới hạn tệp 10 MB, `run_command` theo Allow commands.
- [ ] **Kiểm từng engine nhận ảnh trong kết quả công cụ** (Claude Code, Codex, Antigravity) và model nhìn được ảnh; khoá thẻ kèm lý do khi không.
- [ ] Lời nhắc của khả năng Computer (nhìn–làm–kiểm tra, xin giúp, không làm theo lệnh trên màn hình).
- [ ] Thẻ Computer use, tab Computer trong panel chat.
- **Tiêu chí:** một bài thử thật từ đầu đến cuối (mở một ứng dụng, làm một việc nhỏ, chụp kết quả) ở ít nhất một engine; engine không nhận ảnh thì bị khoá đúng cách.

### 10.6 Hoàn thiện và tài liệu
- [ ] Màn hình hẹp, trợ năng, i18n, trạng thái lỗi (thiếu Node, thiếu trình duyệt, host chưa sẵn sàng).
- [ ] `README.md`, `docs/user-guide.md`, `install.ps1`, `install.sh` (kiểm Node/trình duyệt đã có; không thêm cài máy ảo vào script), `.env.example` nếu có biến mới, `NOTICE` nếu chép mã có giấy phép khác.

### 10.7 Kiểm thử
- pytest: `toolbox` mặc định cho bot mới (Subagents tắt, Web use bật, Computer use tắt), **di chuyển một lần** (Chief, "Reports to" hai chiều, từng giao/nhận việc được bật; bot khác không; chạy lại không đổi; không ghi đè `toolbox` có sẵn; có bản sao lưu) và cưỡng chế, giới hạn Subagents (delegates, `allowAnyAgent`, routine chỉ delegate rõ, depth theo agent, fan-out, `sync` chờ và hết hạn chờ, specialist ẩn được tạo/đồng bộ/xóa/promote, dynamic bị chặn khi tắt và xóa sau lượt gốc, chia sẻ khả năng chỉ trong phạm vi của mẹ, nhân bản đội), `BrowserEgress` (chặn nội bộ, đổi hướng), `BrowserHost` (khoá điều khiển, tắt khi rảnh), provider giả cho `ComputerHost` và `computer_mcp` (quyền, toạ độ, tệp).
- Vitest: thẻ Toolbox (công tắc, khoá, lý do), cài đặt.
- e2e (`pnpm test:workspace` mở rộng): bật/tắt từng khả năng ở trang sửa, Save, thấy công cụ biến mất ở lượt kế (với bot Echo).
- Chạy tay: Web use với trang thật, Computer use với OpenSandbox hoặc E2B, Subagents với đội thật.
- **Tiêu chí xong cả phase:** ba thẻ hoạt động và cưỡng chế thật; test xanh; bài thử tay ghi vào `docs/verification/toolbox.md`.

## 8. Quyết định của người dùng

1. **Web use:** thay hẳn bộ công cụ trình duyệt cũ (`browser_*`, `BrowserService`) bằng Web use mới (Playwright MCP); không giữ dự phòng.
2. **Computer use:** hỗ trợ cả **E2B** (Cloud và tự host Embed) và **OpenSandbox** (Docker).
3. **Mặc định:** **Subagents tắt, Web use bật, Computer use tắt** cho bot mới; **các bot đang phối hợp tự được bật Subagents khi nâng cấp** (mục 2).
4. **Chi phí:** không cần kiểm soát (engine chạy qua CLI); không có sổ chi phí chung, không ngân sách theo agent.
5. **Delegate:** bản đầu dùng cấu hình hiện tại của bot, không ghim phiên bản.
6. **A2A (agent từ xa):** không làm.
7. **Phụ thuộc Computer use** (`e2b-desktop`, `opensandbox`): tùy chọn (nhóm `computer` trong `pyproject.toml`).

Cũng đã chốt từ yêu cầu ban đầu: Subagents làm đủ delegate, specialist viết ngay trong agent mẹ, specialist tự tạo, chế độ `sync`/`async`/`auto`, mẫu đội và nhân bản đội.

## 9. Rủi ro và ngoài phạm vi

| Rủi ro | Cách giảm |
|---|---|
| Chép mã từ aiSocialTeam kéo theo phần riêng của mạng xã hội | Liệt kê và loại ở bước 10.0; test sau mỗi tệp chép |
| Playwright MCP và `@playwright/mcp` đổi hành vi theo phiên bản | Ghim phiên bản, cập nhật có kiểm thử |
| Thay hẳn công cụ trình duyệt cũ: soul và tài liệu còn nhắc `browser_open`... | Xóa mọi nhắc tới công cụ cũ, tìm bằng grep, cập nhật `docs/user-guide.md` và soul của các bot mẫu |
| Engine không nhận ảnh trong kết quả công cụ | Kiểm từng engine; khoá thẻ kèm lý do |
| Máy ảo/trình duyệt chạy nền tốn tài nguyên hoặc còn sót | Tắt khi rảnh, `kill_tree`, kiểm số tiến trình trong test |
| Trang web chặn trình duyệt headless | Công tắc Show browser window; Take over |
| Công cụ trình duyệt/máy tính đi ra mạng nội bộ | Cổng SOCKS5 và tường lửa ra ngoài bắt buộc, mặc định chặn |
| Giao việc lan rộng (nhiều lượt chạy CLI cùng lúc) | Giới hạn độ sâu, fan-out và hạn chờ theo agent; Subagents tắt theo mặc định cho bot mới và chỉ bật tự động cho bot đang phối hợp (không có kiểm soát chi phí, nên bật có chủ đích) |
| `sync` chờ lâu trong một lời gọi công cụ làm engine hết hạn | Hạn `maxWaitSeconds`, chuyển thành không chờ khi hết hạn, kiểm từng engine ở bước 10.2 |
| Specialist ẩn tích tụ hoặc lộ ra danh sách | Gắn `owner` và `inline`, ẩn khỏi mọi danh sách, xóa theo agent mẹ, test dọn dẹp; specialist tạm xóa sau lượt gốc |
| Delegate không ghim phiên bản: sửa bot làm đổi hành vi agent mẹ ngay | Đã chốt: giao diện ghi rõ "uses the bot's current setup"; làm phiên bản ở phase sau nếu cần |
| Di chuyển bật Subagents nhầm hoặc sót bot | Điều kiện "đang phối hợp" rõ ràng (mục 2), chỉ chạy một lần, sao lưu trước, thông báo liệt kê bot đã bật để người dùng chỉnh; không ghi đè `toolbox` có sẵn |
| Bot được tự bật Subagents với `allowAnyAgent` rộng hơn mức cần | Cố ý để giữ hành vi cũ; trang cài đặt nhắc thu hẹp danh sách delegate |
| Model tự tạo specialist với instructions xấu | Mặc định cần duyệt; specialist tạm không có công cụ trừ khi mẹ chia sẻ, không được hỏi người dùng |

**Ngoài phạm vi:** agent từ xa A2A của agenticos (khối "Remote agents" hiện "Soon"); phiên bản và Publish cho delegate; ngân sách và kiểm soát chi phí; Workflows; trình duyệt cho đăng bài mạng xã hội (tính năng riêng của aiSocialTeam); các khả năng khác của Toolbox agenticos (Calculations, Charts, tạo ảnh/video/giọng nói, Sandbox, Visuals…).
