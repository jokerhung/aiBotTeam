# Phase 11 — Resources: sản phẩm do agent tạo ra

**Mục tiêu:** thêm trang **Resources** vào nhóm **Knowledge** của menu trái. Đó là nơi lưu **sản phẩm agent làm ra** — một trang HTML (báo cáo, dashboard), một tệp Markdown, một ảnh, hoặc một **bài đăng (post)** gồm chữ và ảnh — để người dùng xem, sửa, duyệt, và để agent khác hoặc **Routine** dùng lại **bằng `resource_id` + `version`** thay vì chuyền đường dẫn tệp qua lời nhắn. Ví dụ: Creator Agent tạo bài đăng và cất vào Resources; Scheduler Agent tạo routine (bản nháp) chỉ trỏ tới `res_ab12@v3` của bài đó; tới giờ routine chạy, agent đăng đúng nội dung của phiên bản v3 đã được duyệt.

**Ba nguyên tắc của phase này**

1. **Có quản lý phiên bản.** Mỗi lần nội dung đổi là một phiên bản mới (`v1`, `v2`, …), bất biến. **Chỉ giữ 10 phiên bản gần nhất** của mỗi resource (ngoại lệ ở mục 2: bản đang được tham chiếu).
2. **Mọi chỗ trỏ tới resource đều phải nêu rõ cả `resource_id` và `version`** — routine, ảnh trong bài đăng, ký hiệu trong HTML, thẻ trong chat, kết quả công cụ, địa chỉ trên giao diện, bản ghi lần chạy. Không có kiểu "mới nhất" ngầm: nơi nào cho phép bỏ trống phiên bản thì máy chủ **giải thành số cụ thể ngay lúc ghi** và lưu số đó. Dạng viết chuẩn: `res_ab12@v3`.
3. **Cơ sở dữ liệu không chứa nội dung** (HTML, Markdown, ảnh, chữ của bài đăng đều nằm trong tệp); trong DB chỉ có siêu dữ liệu nhỏ và **đường dẫn tương đối** tới tệp.

**Trạng thái:** đã triển khai và kiểm chứng ngày 23/11/2026. Có kho tệp và phiên bản, sáu công cụ MCP, API, trang Resources, thẻ chat, cài đặt Toolbox, routine ghim phiên bản và luồng Creator → Scheduler. Xem [biên bản kiểm chứng](verification/resources.md).

**Tham chiếu**

- agenticos, tính năng **Apps** (`/apps`, năng lực `artifacts` trong Toolbox, mã ở `app/agents/capabilities/artifacts/` và `app/services/artifact.py` của ứng dụng tham chiếu): agent xuất bản một trang bằng `publish_artifact`; mỗi bản xuất bản là một **artifact** có chủ sở hữu, quyền xem, đường dẫn cố định và **các phiên bản**; sáu công cụ `publish_artifact`, `read_artifact`, `list_artifacts`, `preview_artifact`, `export_artifact`, `share_artifact`. Trang Apps lúc chưa có gì ghi "Nothing published yet. An agent with the Apps capability publishes an app here when you ask it for a report or a dashboard. It is private to you until you share it."
- Học từ artifact của agenticos: **tên là danh tính** (cùng agent xuất bản lại cùng tên thì ra phiên bản mới của cùng resource); **phiên bản bất biến**, xuất bản đúng nội dung hiện tại thì `unchanged`, không thêm phiên bản; sửa bằng **danh sách thay thế chính xác** (`edits` old→new, mỗi `old` đúng một lần) kèm số phiên bản đã đọc để không ghi đè bản mới hơn; `read` cắt ở 100.000 ký tự; `list` có giới hạn; HTML chạy trong khung cách ly. Khác agenticos: giữ 10 phiên bản (agenticos có `ARTIFACT_MAX_VERSIONS`), và **mọi liên kết phải mang số phiên bản**.
- BotTeam hiện tại: `server/botteam/social_workflow.py` (Creator lưu một tệp Markdown + ảnh trên đĩa rồi chuyền **đường dẫn tuyệt đối** cho Scheduler, Scheduler nhét cả chú thích và đường dẫn vào lời nhắn của routine nháp); `server/botteam/routines.py` (`create`, `tool_trigger`, `start_run`), `store.py` (`routine_defs`, `routine_runs`), kho tệp đính kèm `home/attachments` và `GET /api/attachments/{name}` ở `main.py`, `web/components/FilePreview.tsx` (cửa sổ xem trước ảnh và tệp chữ), `web/lib/nav.ts` (nhóm Knowledge hiện có Knowledge bases và Documents là "Soon", cùng Skills).
- Quy tắc dự án `AGENTS.md`: tham khảo ứng dụng tham chiếu, rà `README.md`, `install.ps1`, `install.sh` trước khi push.

**Phụ thuộc:** Phase 8 (bố cục menu, tuyến hash), Phase 9 (trang Agent, Toolbox), Phase 10 (Toolbox có công tắc theo agent). Routine (Phase 4) đã có.

## 1. Hiện trạng và vấn đề cần giải

| | Hôm nay | Sau phase này |
|---|---|---|
| Sản phẩm của agent | Là tệp rời trong thư mục làm việc của từng bot; người dùng không có chỗ xem chung; agent khác chỉ biết đường dẫn do lời nhắn | Có kho chung có danh mục, loại, phiên bản, trạng thái, xem trước ngay trong giao diện |
| Bài đăng (Creator → Scheduler) | Tệp `.md` + ảnh trên đĩa, chuyền đường dẫn tuyệt đối; routine nháp chứa nguyên chú thích trong lời nhắn; sửa bài thì phải sửa lời nhắn của routine | Bài đăng là một resource; routine chỉ giữ `res_x@vN`; bài sửa xong là phiên bản mới, routine vẫn chạy đúng bản đã duyệt cho tới khi người dùng chuyển sang bản mới |
| Duyệt trước khi đăng | Người dùng đọc lời nhắn của routine nháp trong Routines | Người dùng xem bài (ảnh, chữ) ở Resources, bấm **Approve** cho **một phiên bản cụ thể**; routine không chạy với phiên bản chưa duyệt |
| Ảnh/HTML do agent tạo | Chỉ thấy khi mở thư mục làm việc hoặc nếu agent dán đường dẫn | Thẻ ở Resources và thẻ trong khung chat, bấm là mở cửa sổ xem trước đúng phiên bản |

## 2. Mô hình dữ liệu

**Resource** = một thứ có tên, chủ (agent), loại, và một dãy phiên bản bất biến.

**Bảng `resources`** (trong `store.py`, cùng chỗ với `routine_defs`) — chỉ siêu dữ liệu nhỏ:

- `id` (`res_` + hex, bền), `kind` (`html` | `markdown` | `image` | `post`), `name` (danh tính trong phạm vi chủ, chữ thường gạch nối, ≤ 80), `title`, `owner_bot` (null = người dùng tạo), `thread_id` (cuộc trò chuyện sinh ra nó), `tags` (≤ 10, JSON ngắn), `current_version` (số), `archived` (0/1), `created_at`, `updated_at`.

**Bảng `resource_versions`** — mỗi phiên bản một dòng, **không chứa nội dung**:

- `resource_id`, `version` (1, 2, 3 … tăng dần, không dùng lại số), `path` (**đường dẫn tương đối** của tệp chính, tính từ thư mục gốc kho `home/resources/`, ví dụ `res_ab12/v3/index.html`; luôn dùng dấu `/`, không bắt đầu bằng `/` hay ổ đĩa, không có `..`), `files` (JSON ngắn các đường dẫn tương đối của tệp phụ, ví dụ `res_ab12/v3/post.json` đi kèm), `mime`, `size`, `sha256`, `status` (`draft` | `approved` | `published`), `note`, `created_by` (`bot:<id>` hoặc `person`), `created_at`. Khoá chính `(resource_id, version)`.

**Quy tắc "không có nội dung trong DB"**

- HTML, Markdown, ảnh **và cả chữ/chú thích/danh sách ảnh của bài đăng** đều là **tệp** trong `home/resources/<resource_id>/v<n>/` (bài đăng là `post.json` + tệp ảnh nằm ở các resource ảnh riêng). DB chỉ có đường dẫn tương đối, kích thước, mã băm, trạng thái và các trường ngắn ở trên.
- Đường dẫn tương đối nên chuyển thư mục dữ liệu sang chỗ khác, sao lưu/khôi phục (`backup.py` thêm `resources/`) hay đổi máy đều không hỏng. Ghép đường dẫn tuyệt đối **chỉ ở thời điểm đọc**, bằng `root / path` rồi kiểm tra kết quả vẫn nằm trong `root` (chống `..` và liên kết tượng trưng); mọi tên tệp đều do máy chủ đặt, không dùng tên do agent đưa.
- Ghi tệp bằng "viết ra tệp tạm rồi đổi tên" để phiên bản chỉ xuất hiện khi tệp đã đủ; chỉ sau đó mới chèn dòng vào `resource_versions`.

**Danh tính và phiên bản**

- Danh tính là `(owner_bot, name)`. Cùng agent xuất bản lại cùng `name` → **phiên bản mới** của cùng resource (`current_version` tăng, nội dung phiên bản cũ giữ nguyên). Tên mới → resource mới. Agent khác trùng tên → resource khác (không bao giờ ghi đè của người khác). Xuất bản đúng byte của phiên bản hiện tại → trả `unchanged`, không thêm phiên bản.
- **Trạng thái nằm trên phiên bản**, không trên resource: phiên bản mới luôn bắt đầu `draft`; người dùng duyệt (`approved`) **đúng phiên bản đó**; routine đã đăng thì phiên bản được đánh `published`. Phiên bản mới ra đời không làm mất duyệt của phiên bản cũ, và không tự được duyệt. Trạng thái hiển thị ở thẻ là của phiên bản hiện tại.
- **Giữ 10 phiên bản gần nhất.** Sau mỗi lần thêm phiên bản, xoá (tệp trước, dòng DB sau) các phiên bản cũ hơn 10 bản mới nhất, **trừ** phiên bản đang được tham chiếu (routine trỏ tới, hoặc bài đăng dùng ảnh đó): bản đang dùng không bao giờ bị dọn mất khiến routine hỏng; nó nằm trong lịch sử với nhãn "đang dùng" và được dọn khi không còn ai trỏ tới. Số phiên bản không bao giờ dùng lại.

**Nội dung theo loại** (đều là tệp)

- `html`: `index.html` tự chứa, ≤ 2 MB. Ảnh nhúng bằng `data:` hoặc bằng ký hiệu **`{{resource:res_img1@v2}}` (bắt buộc có phiên bản)**; máy chủ đổi thành địa chỉ nội dung của ảnh đó khi phục vụ, ký hiệu thiếu `@v` bị từ chối khi xuất bản.
- `markdown`: `content.md`, ≤ 500 KB, hiển thị bằng cùng bộ vẽ Markdown của chat.
- `image`: png, jpeg, gif, webp (không svg vì khó làm sạch), ≤ 10 MB, kèm `alt` bắt buộc khi do agent tạo (lưu trong tệp siêu dữ liệu `meta.json` cạnh ảnh, không lưu trong DB).
- `post`: `post.json` = `{ platform, text, hashtags[], media: [{ "resource_id": "res_img1", "version": 2, "alt": "…" }], link?, scheduleHint? }`. **Mỗi ảnh của bài phải nêu `resource_id` và `version`.** Ảnh của bài là các resource `image` riêng (tái dùng, xem trước, không trùng); khi agent xuất bản bài với `images=[đường dẫn…]` máy chủ tự tạo các resource ảnh con (phiên bản 1) và điền `media` với đúng `resource_id` và `version`. `text` là chú thích đầy đủ để đăng, ≤ 20.000 ký tự. Đổi chữ hay đổi ảnh của bài tạo **phiên bản mới của bài**, không sửa phiên bản cũ.

## 3. Công cụ của agent

Thêm vào `TOOL_NAMES` (`agents.py`) và danh sách công cụ của cầu nối MCP (`mcp_bridge.py`), cùng cách các công cụ đội hiện có. Chỉ được cấp cho agent bật năng lực **Resources** (mục 6). **Mọi kết quả trả về đều có `id`, `version` và `ref` (`res_ab12@v3`)**, và agent được dặn luôn chuyền `ref` nguyên vẹn khi nhắc tới resource.

| Công cụ | Việc | Quy tắc |
|---|---|---|
| `publish_resource` | `kind`, `name`, `title`, và **một** trong: `content` (chuỗi cho html/markdown), `file` (đường dẫn tuyệt đối trong thư mục làm việc của agent, cho ảnh/html/md), hoặc cho `post`: `text`, `platform`, `images` (đường dẫn tệp, hoặc `ref` đủ `id@vN` của ảnh đã có) và `alts`; thêm `tags`, `note` | Tệp phải nằm **trong thư mục làm việc** của agent, đúng loại và cỡ; trả `{id, version, ref, unchanged, url}`; luôn tạo phiên bản mới ở trạng thái `draft` (agent không tự duyệt); tự dọn phiên bản cũ quá 10 |
| `read_resource` | `ref` (`id@vN`) hoặc `id` + `version`; **nếu chỉ đưa `id` hoặc `name`** thì máy chủ đọc phiên bản hiện tại và **nói rõ số phiên bản** trong kết quả | Trả nội dung chữ (cắt 100.000 ký tự) và siêu dữ liệu; với ảnh trả mô tả + đường dẫn đã chép vào thư mục làm việc để agent mở |
| `update_resource` | `id`, `base_version`, và `edits=[{old,new}]` hoặc `text`/`title`/`tags` | Chỉ chủ mới sửa; thay thế chính xác; **tạo phiên bản mới** từ `base_version`; từ chối nếu `base_version` không phải phiên bản hiện tại (bảo agent đọc lại) |
| `list_resources` | `kind?`, `status?`, `mine?`, `query?` | Tối đa 50, mới nhất trước; mỗi dòng có `id`, `current_version`, `ref`, trạng thái của phiên bản hiện tại; agent thấy mọi resource trừ đã lưu trữ |
| `list_resource_versions` | `id` | Tối đa 10 dòng: `version`, `status`, `created_at`, `created_by`, `note`, `in_use` |
| `set_resource_status` | `ref`, `status` ∈ {`draft`,`published`} | Agent **không** đặt `approved` (chỉ người dùng). `published` chỉ khi routine đang chạy đúng `ref` đó |

Mỗi lần xuất bản/sửa gửi một khung `resource` qua bus để thẻ cập nhật ngay, và thả một **thẻ trong khung chat** (loại tin nhắn `resource`, như `RoutineCard`). **Tin nhắn chỉ lưu `{resource_id, version, kind, title}`**, không lưu nội dung; thẻ hiển thị `Tiêu đề · res_ab12@v3` và nút mở cửa sổ xem trước đúng phiên bản ấy.

## 4. API (cho giao diện và người dùng)

Địa chỉ nội dung **luôn có số phiên bản**, không có địa chỉ "mới nhất" cho tệp nội dung.

`GET /api/resources?kind=&status=&bot=&q=&limit=` (mỗi dòng có `id`, `current_version`, `ref`) · `POST /api/resources` (người dùng tạo: tải tệp hoặc `{kind:"markdown"|"post", …}` → phiên bản 1) · `GET /api/resources/{id}` (siêu dữ liệu + `current_version`) · `PATCH /api/resources/{id}` (`title`, `tags`, `archived`) · `DELETE /api/resources/{id}` (kèm cảnh báo nếu còn routine trỏ tới) · `GET /api/resources/{id}/versions` (tối đa 10 + bản đang dùng) · `POST /api/resources/{id}/versions` (người dùng đăng phiên bản mới, kèm `base_version`; hoặc `{restore: n}` để tạo phiên bản mới từ nội dung của bản `n`) · `PATCH /api/resources/{id}/versions/{n}` (`status`: người dùng đặt `approved`/`draft`, `note`) · `GET /api/resources/{id}/versions/{n}/content` (nội dung của đúng phiên bản đó) · `GET /api/resources/{id}/versions/{n}/files/{name}` (tệp phụ) · `GET /api/resources/{id}/used-by` (routine và bài đăng đang trỏ tới, mỗi mục kèm phiên bản được trỏ).

**Phục vụ an toàn** (theo cách `/api/attachments/{name}` đang làm): ảnh trả `image/*` + `nosniff`; Markdown trả `text/plain`; **HTML** trả với `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'` (nguồn gốc mờ, không đọc được cookie hay API của ứng dụng, không gọi mạng); giao diện đặt nó trong `<iframe sandbox="allow-scripts">`, không bao giờ `allow-same-origin`. Đường dẫn tệp do agent đưa vào được chuẩn hoá và phải nằm trong thư mục làm việc (cùng cách `bot_files`); đường dẫn đọc từ DB luôn ghép với gốc kho rồi kiểm tra vẫn nằm trong gốc.

## 5. Giao diện

- **Menu:** thêm vào nhóm Knowledge (`nav.ts`) mục **Resources** (`view: "resources"`, `testid: nav-resources`, biểu tượng `Package`/`LayoutGrid`, phím `G` rồi `E`). **Tuyến:** `#/resources` (danh sách) và **`#/resources/<id>/v/<n>`** (xem đúng phiên bản `n`); địa chỉ không có phiên bản (`#/resources/<id>`) được chuyển ngay sang `…/v/<phiên bản hiện tại>`. Thêm `view` mới vào `VIEWS`, `Shell.tsx`, `useHashRoute`. Giữ Knowledge bases và Documents là "Soon".
- **Trang Resources** (`ResourcesPage`, cùng khung `PageFrame` và kiểu thẻ của Routines):
  - Hàng đầu: tab theo loại (**All · Posts · Pages · Markdown · Images** kèm số đếm) và bộ lọc trạng thái (**Draft · Approved · Published**), ô tìm kiếm, hộp lọc theo agent, nút **New** (người dùng tạo bài/markdown hoặc tải tệp lên).
  - **Thẻ:** vùng xem nhanh ở trên (ảnh thu nhỏ; với post là ảnh đầu + vài dòng chữ; với html/markdown là biểu tượng loại và trích đoạn), nhãn loại và trạng thái có màu, tiêu đề, **`res_ab12 · v3`** (id rút gọn và phiên bản hiện tại), `Agent · thời điểm cập nhật`, dòng "Dùng bởi N routine"; chân thẻ: **Open**, **Download**, **Approve** (khi phiên bản hiện tại là `draft`), `…` (đổi tên, tag, lưu trữ, xoá, **Copy reference** → chép `res_ab12@v3`).
  - **Cửa sổ xem** (mở ở thẻ, ở thẻ trong chat, hoặc tuyến `#/resources/<id>/v/<n>`): thanh trên có tên, **`res_ab12@v3`**, danh sách chọn phiên bản (tối đa 10, kèm trạng thái và nhãn "đang dùng"), Download, Copy, đóng; thân tuỳ loại — `html` trong khung cách ly, `markdown` đã vẽ, `image` phóng to, **`post`** hiển thị như bài thật (ảnh theo thứ tự, mỗi ảnh ghi `res_img1@v2`, chú thích bên dưới, nút **Copy caption**); nút **Approve / Back to draft** cho phiên bản đang xem; **Edit** tạo phiên bản mới (không sửa tại chỗ phiên bản cũ), **Restore this version** tạo phiên bản mới từ nội dung cũ; danh sách "Dùng bởi" (routine kèm phiên bản được trỏ; nếu trỏ bản cũ hơn bản hiện tại thì hiện **"Dùng v2 — có v5 mới"** và nút chuyển).
  - Dùng lại `FilePreview` cho tệp/ảnh đơn; xây `ResourceViewer` riêng cho `html` và `post`.
- **Chat:** thẻ `resource` (mục 3); liên kết `#/resources/<id>/v/<n>` trong lời nhắn mở tại chỗ (đã có cho đường dẫn hash).
- **Trang sửa Agent → Toolbox:** thẻ năng lực **Resources** (mục 6).
- **Routines:** xem mục 7.
- **Tiếng Việt:** thêm nhãn mới vào `web/lib/*-i18n-vi.ts` (bài kiểm tra i18n sẽ chặn nếu sót).

## 6. Năng lực "Resources" trong Toolbox

Giống năng lực **Apps** (`artifacts`) của agenticos: thêm mục `resources` vào `catalog.ts` (nhóm "Knowledge" hoặc "Files"), công tắc theo agent trong trường `toolbox.resources.enabled`. **Mặc định bật** cho agent mới và agent cũ (chỉ thêm công cụ, không đổi hành vi nào hiện có); tắt thì các công cụ ở mục 3 không được cấp. Cài đặt riêng (hộp bên phải thẻ): cỡ tối đa mỗi tệp (mặc định theo mục 2), có cho phép `html` không (mặc định bật), có tự thêm thẻ vào chat không. Claude Code và Codex không có công cụ tương đương nên không khoá (`native.ts` không đổi).

## 7. Routine tham chiếu resource

- **Trường mới trên routine:** `resource_id` **và `resource_version`** (hai cột luôn đi cùng nhau; một cột có, cột kia phải có) và `require_approved` (mặc định `true` khi resource là `post`, ngược lại `false`). Cột mới trong `routine_defs` (di chuyển thêm cột, rỗng cho routine cũ). **Routine không bao giờ trỏ "mới nhất"**: nếu công cụ hay người dùng bỏ trống phiên bản thì máy chủ ghi **phiên bản hiện tại lúc đó** thành số cụ thể và trả lại số ấy.
- **Khi routine chạy** (`start_run`): giải `resource_id@vN`; nếu resource hay phiên bản đó không còn, hoặc cần duyệt mà phiên bản đó chưa `approved` → lần chạy **`skipped`** với lý do rõ ("resource res_ab12@v3 is not approved", "resource res_ab12@v3 is missing") và thông báo cho người dùng, **không** tự đăng và không tự chuyển sang phiên bản khác. Nếu hợp lệ: chép tệp của phiên bản đó vào `<thư mục làm việc của agent>/.botteam/resources/<id>/v<n>/` (để các engine bị giới hạn thư mục vẫn đọc được ảnh) và **ghép một khối vào đầu lời nhắn**: loại, tiêu đề, **`res_ab12@v3`**, **toàn văn chú thích**, và với mỗi ảnh: `res_img1@v2`, đường dẫn tuyệt đối của bản chép, alt. Lời nhắn của routine có thể dùng chỗ giữ chỗ `{resource.ref}`, `{resource.text}`, `{resource.title}`, `{resource.images}`; nếu không dùng thì khối tự được thêm.
- **Công cụ `trigger`**: thêm `resource_id`, `resource_version`, `require_approved` vào `create`/`update` (và schema ở `mcp_bridge.py`); kiểm tra cả resource lẫn phiên bản tồn tại; hoạt động chung với `enabled=false` (bản nháp) và với lịch một lần (`at` nhận ngày giờ ISO). Muốn chạy bản mới thì `update` với `resource_version` mới.
- **Biểu mẫu Routines (`AutomationForm`) và thẻ routine:** ô chọn **Resource** rồi **Version** (danh sách tối đa 10 bản kèm trạng thái; mặc định là bản hiện tại), hộp "Chỉ chạy khi đã duyệt"; thẻ routine hiện chip **`res_ab12@v3`** (bấm mở cửa sổ xem đúng phiên bản) và cảnh báo khi bật routine mà phiên bản đó chưa duyệt hoặc đã có bản mới hơn.
- **Sau khi chạy xong:** nếu lần chạy thành công, agent được lời nhắn "đặt trạng thái published" cho đúng `ref` (`set_resource_status`); `RoutineRun.detail` ghi **`res_ab12@v3`**. Trang Resources hiện "Đã chạy N lần" của phiên bản đó và mốc gần nhất.
- **Webhook:** để sau (cùng cơ chế `resource_id` + `resource_version` nếu cần).

## 8. Chuyển luồng mạng xã hội sang Resources

- `social_workflow.py` (`creator`, `scheduler`, `master`): thay "lưu tệp Markdown + ảnh rồi chuyền đường dẫn" bằng "`publish_resource(kind="post", …)` rồi chuyền **`ref` đầy đủ (`res_ab12@v1`)** cho Scheduler"; Scheduler tạo **một routine nháp** (`enabled=false`, tên có `[DRAFT]`) với `resource_id` + `resource_version` và lời nhắn **chỉ gồm các bước đăng** (không nhét lại chú thích); không bao giờ tự `approve`, bật hay chạy. Khi Creator sửa bài thì báo `ref` mới (`@v2`) và Scheduler cập nhật routine nháp bằng `trigger update`. Giữ nguyên nguyên tắc duyệt trước.
- Template đội social (`team_templates.py`) bật năng lực Resources cho Creator, Scheduler, Master.
- **Các bản nháp đang có** (những routine `[DRAFT]` chứa chú thích trong lời nhắn) giữ nguyên, không tự chuyển.

## 9. Quyết định cần chốt — ✅ Đã hoàn thành

Đã chốt toàn bộ: **có quản lý phiên bản, giữ 10 bản gần nhất** (kèm ngoại lệ bản đang được tham chiếu không bị dọn); **mọi liên kết nêu rõ `resource_id` và `version`**, không có "mới nhất" ngầm; **nội dung nằm trong tệp, DB chỉ lưu đường dẫn tương đối** và siêu dữ liệu nhỏ; trạng thái duyệt nằm trên từng phiên bản; ảnh bài đăng là resource riêng; cổng duyệt mặc định cho `post`; chép tệp vào thư mục làm việc khi routine chạy; agent đọc được mọi resource, chỉ chủ sửa; HTML chạy trong khung cách ly có script, không mạng; chưa có chia sẻ công khai; giới hạn cỡ html 2 MB, markdown 500 KB, ảnh 10 MB; không chuyển các nháp cũ.

## 10. Kế hoạch làm — ✅ Đã hoàn thành

- [x] Kho nội dung trên đĩa, DB chỉ lưu siêu dữ liệu và đường dẫn tương đối; giữ 10 bản gần nhất và các bản đang được tham chiếu.
- [x] API cho bốn loại resource, chỉnh sửa chính xác, phiên bản, khôi phục, duyệt, tìm kiếm, lưu trữ, xoá và tải xuống.
- [x] Sáu công cụ MCP cùng thẻ chat và công tắc/cài đặt Resources theo agent.
- [x] Trang Resources, xem trước HTML cách ly, ảnh/bài đăng/Markdown, chọn phiên bản, nơi đang dùng và nhãn tiếng Việt.
- [x] Routine ghim phiên bản, cổng duyệt, chép ảnh vào workspace, nhật ký ghi ref và trường Resource + Version trong biểu mẫu.
- [x] Chuyển hướng dẫn mẫu Creator/Scheduler/Master sang Resources, sao lưu trước khi cập nhật hướng dẫn cũ nhận diện được; giữ nguyên nháp cũ và hướng dẫn tự viết.
- [x] Kiểm thử máy chủ, web, trình duyệt và Creator/Scheduler thật; biên bản ghi rõ kết quả và giới hạn của phép thử.

## 11. Kiểm chứng

- **Máy chủ (pytest):** tạo resource bốn loại; xuất bản lại cùng tên ra phiên bản mới, cùng nội dung thì `unchanged`; **sau 12 lần xuất bản chỉ còn 10 phiên bản, số phiên bản không dùng lại, và một phiên bản đang được routine trỏ tới không bị dọn**; `edits` đúng một lần hoặc từ chối; từ chối `base_version` cũ; tệp ngoài thư mục làm việc bị từ chối; cỡ/loại sai bị từ chối; agent khác không sửa được resource của người khác; agent không tự `approved`; HTML được phục vụ với CSP cách ly; ký hiệu `{{resource:id}}` thiếu `@v` bị từ chối; `media` của bài thiếu `version` bị từ chối; **mọi kết quả công cụ và mọi phản hồi API về resource đều có `id` và `version`**; **DB không chứa nội dung** (không cột nào chứa HTML/Markdown/ảnh/chữ bài đăng; `path` luôn tương đối, không `..`, không bắt đầu bằng `/` hay ổ đĩa; đổi thư mục dữ liệu sang chỗ khác vẫn đọc được); đường dẫn trong DB bị sửa thành `../x` vẫn không thoát khỏi gốc kho; xoá resource đang có routine trỏ tới có cảnh báo; routine với `resource_id@vN`: chạy khi `approved`, `skipped` khi chưa duyệt/đã xoá, bỏ trống phiên bản thì được ghi số cụ thể, khối tài nguyên được ghép và ảnh được chép; `trigger` nhận `resource_id` + `resource_version`; sao lưu có `resources/`.
- **Web (vitest + e2e Playwright):** mục menu; tuyến `#/resources/<id>` chuyển sang `…/v/<n>`; thẻ theo loại hiển thị `id · vN`; lọc/tìm; cửa sổ xem từng loại và chọn phiên bản (HTML chạy trong khung, không đọc được `document.cookie` của trang cha); Edit tạo phiên bản mới; Restore; Approve đúng phiên bản; chọn Resource + Version trong biểu mẫu routine; chip `res@vN` trên thẻ routine; thẻ chat hiển thị `ref`; i18n đầy đủ.
- **Thực tế:** bật Creator tạo một bài có ảnh bằng bot thật; Scheduler tạo routine nháp với `res_x@v1`; người dùng duyệt v1 và bật; Creator sửa bài ra v2, routine vẫn chạy v1 cho tới khi người dùng chuyển; xem lần chạy ghi `res_x@v1`.

## 12. Rủi ro

- **HTML do agent viết** là nội dung không tin cậy: chỉ phục vụ trong khung cách ly với CSP chặt; không bao giờ `allow-same-origin`; không cho tải tài nguyên ngoài.
- **Đường dẫn tệp do agent đưa vào và đường dẫn đọc từ DB:** chuẩn hoá, giữ trong thư mục làm việc (vào) hoặc trong gốc kho (ra); cấm liên kết tượng trưng thoát ra ngoài; tên tệp trong kho do máy chủ đặt.
- **Dọn phiên bản làm hỏng tham chiếu:** bản đang được routine hoặc bài đăng trỏ tới không bao giờ bị dọn; nên kho có thể giữ hơn 10 bản khi có bản đang dùng (hiển thị rõ trong lịch sử).
- **Hai nơi lệch nhau (DB và đĩa):** ghi tệp trước, chèn dòng DB sau; một lệnh kiểm tra khi khởi động báo phiên bản mất tệp (đánh dấu hỏng, không chạy routine trỏ tới nó).
- **Phình kho:** giới hạn cỡ và 10 bản; trang có nút lưu trữ/xoá; hiển thị dung lượng đang dùng.
- **Routine chạy nội dung chưa duyệt:** cổng duyệt trên từng phiên bản, mặc định cho `post`; routine ghim phiên bản cụ thể; khối tài nguyên và lần chạy ghi `res@vN`.
- **Trùng việc với Documents/Knowledge bases ("Soon"):** Resources là sản phẩm **do agent tạo**, Documents/Knowledge bases là nguồn **người dùng cung cấp**; giữ hai nhóm tách biệt về tên và về trang.
