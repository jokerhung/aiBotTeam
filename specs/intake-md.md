# Spec: quy trình nhận tin khai báo bằng `intake.md`

| | |
|---|---|
| Trạng thái | Đã làm xong (mã, test, giao diện); các chỗ khác với bản nháp ghi ở mục 15 |
| Ngày | 2026-11-18 |
| Liên quan | `docs/phase-6-telegram-channel.md`, `server/botteam/channels/`, `web/components/InputChannels.tsx`, `web/components/NewBotDialog.tsx` |
| Bản gốc | OpenMausBot không có kênh Telegram/Zalo hay quy trình nhận tin; đây là phần thêm riêng của BotTeam (như phase 6) |

## 1. Mục tiêu

Hiện nay mọi bot nhận tin từ Telegram, Zalo bot hay Zalo cá nhân đều chạy theo một kiểu cố định trong mã:

1. Gom ảnh và tin nhắn vào `jobs/<mã lô>/`.
2. Chờ người gửi bấm 🔍 Kiểm kê hoặc gõ `/kiemke`.
3. Chạy bot với lời nhắc nhập ở tab Input.

Spec này đưa quy trình đó ra **một file `intake.md` trong thư mục làm việc của bot**:

- **Bắt buộc với bot có input:** mỗi bot có input (được cấp quyền dùng một tài khoản Telegram/Zalo) phải có `intake.md` hợp lệ.
- **Tạo khi thêm input:** khi bot được cấp input, nếu thư mục làm việc **chưa có** `intake.md` thì BotTeam tạo file mặc định. File sẵn có không bao giờ bị ghi đè. Bot không có input thì không tạo.
- **Quy trình mặc định:** chờ 30 giây không có ảnh hoặc tin nhắn mới, tự lưu ảnh vào `jobs/<session_id>/`, rồi chạy tiếp theo chỉ dẫn (Instructions) của bot.
- **Mọi bot có thư mục làm việc:** tạo bot mà không nhập thư mục thì BotTeam tạo `<thư mục chạy>/workspaces/<bot_id>/`.
- **Sửa quy trình là sửa file:** đổi thời gian chờ, mẫu thư mục (ví dụ `{machine}/{date}/{phase}/`), tin xác nhận, lời nhắc khi chạy mà không cần sửa mã hay vào giao diện.

## 2. Phạm vi

**Trong phạm vi**

- Định dạng `intake.md` (phần đầu YAML, phần thân Markdown), giá trị mặc định, cách kiểm tra.
- Thư mục làm việc mặc định khi tạo bot (mục 5).
- Tạo `intake.md` mặc định khi thêm input, chỉ khi chưa có (mục 5).
- Đồng hồ im lặng: tự chạy khi hết N giây không có tin mới.
- Lưu ảnh và tin nhắn vào thư mục theo mẫu ngay khi nhận.
- `machines.md` (tùy chọn) để khớp tên máy trong chú thích.
- Chuyển các bot đang có input sang quy trình mới (mục 9). Bot kiểm kê máy bán hàng chuyển hẳn sang cách mới.
- Giao diện: hiện quy trình đang dùng và lỗi của file trong tab Input; bỏ các ô đã chuyển vào file.
- **Sửa `intake.md` (và `machines.md`) ngay trong Bot settings** (mục 7a).

**Ngoài phạm vi (làm sau nếu cần)**

- Giao việc cho bot khác trong quy trình (`run.bot: <tên bot>`). Chỗ trong định dạng đã chừa sẵn (mục 4.3) nhưng chưa làm.
- Mang `intake.md` theo khi xuất hoặc nhập bot (`*.bot.md`).
- Sửa `intake.md` bằng biểu mẫu từng ô (chọn thời gian, chọn mẫu thư mục). Bản này sửa trực tiếp nội dung file trong Bot settings (mục 7a).
- Nhóm Zalo (kênh Zalo vẫn chỉ nhận chat riêng).

## 3. Khái niệm

| Từ | Nghĩa |
|---|---|
| **Input** | Một quyền (grant) cho bot dùng một tài khoản Telegram/Zalo, như hiện nay |
| **Phiên nhận tin (session)** | Các tin một người gửi trong một chat, từ tin đầu cho tới lúc bot chạy. Chính là **lô** (`channel_batches`) hiện có |
| **`session_id`** | Mã của lô hiện có, dạng `b_` + 8 ký tự (ví dụ `b_e2c14a12`), dùng làm tên thư mục phiên |
| **Đồng hồ im lặng** | Đếm ngược `quietSeconds`; mỗi ảnh hoặc tin mới của phiên đặt lại từ đầu |
| **Thư mục phiên (`{folder}`)** | Thư mục ảnh của phiên được lưu vào, tính từ mẫu `save.path`, nằm trong thư mục làm việc. Mặc định `jobs/{session}/` |
| **Thư mục chạy** | Thư mục hiện hành của tiến trình server BotTeam lúc khởi động. Với `start.bat` / `pnpm dev` là thư mục gốc của repo |

## 4. File `intake.md`

### 4.1 Vị trí và tên

- Đặt ở **gốc thư mục làm việc** (`cwd`) của bot, tên đúng `intake.md` (chữ thường).
- Cùng thư mục có thể có:
  - `AGENTS.md`: chỉ dẫn cho engine; Codex tự đọc, Claude đọc qua chỉ dẫn của bot.
  - `machines.md` (mục 6).
- Phần đầu YAML nằm giữa hai dòng `---` và là phần duy nhất server đọc để chạy quy trình. Phần thân Markdown là ghi chú cho người đọc và **được gửi kèm cho bot** khi chạy, như một phần chỉ dẫn.

### 4.2 Mẫu mặc định (tạo khi thêm input)

```markdown
---
format: botteam.intake
version: 1
mode: collect                 # collect: gom rồi chạy | answer: trả lời từng tin
trigger:
  quietSeconds: 30            # tự chạy khi 30 giây không có ảnh hoặc tin nhắn mới
  button: true                # vẫn cho bấm 🔍 Kiểm kê (hoặc gõ /kiemke) để chạy ngay
save:
  path: "jobs/{session}/"     # ảnh lưu vào <thư mục làm việc>/jobs/<session_id>/
ack: "Đã nhận {photos} ảnh. Sẽ xử lý sau {quietSeconds} giây nếu không có thêm."
run:
  prompt: "Phiên {session}: {photos} ảnh và {texts} tin nhắn mới đã lưu trong {folder}. Làm tiếp theo chỉ dẫn của bạn. File kết quả cần gửi lại thì ghi vào {folder}out/."
limits:
  maxPhotos: 40
  timeoutSec: 900
  retentionDays: 60
---
# Quy trình nhận tin

Bot này nhận ảnh và tin nhắn từ Telegram/Zalo. Khi 30 giây không có gì mới, ảnh được lưu vào
jobs/<mã phiên>/ và bot làm tiếp theo chỉ dẫn của nó.

Sửa phần giữa hai dòng `---` để đổi quy trình. Phần này (sau dòng `---` thứ hai) được gửi cho bot mỗi lần chạy.
```

Với input ở chế độ trả lời từng tin (Answer every message), file mặc định giống trên nhưng có `mode: answer` và `trigger.quietSeconds: 0`, tức trả lời ngay như hiện nay.

### 4.3 Các trường

| Trường | Kiểu, giới hạn | Mặc định | Ý nghĩa |
|---|---|---|---|
| `format`, `version` | `botteam.intake`, `1` | bắt buộc | Nhận ra file và phiên bản định dạng |
| `mode` | `collect` \| `answer` | `collect` | `collect`: gom phiên rồi chạy một lượt. `answer`: mỗi tin là một câu hỏi, trả lời trong cùng chat (chế độ "Answer every message" hiện nay) |
| `trigger.quietSeconds` | số nguyên 0 hoặc 10–600 | `30` | Hết số giây này không có tin mới thì chạy. `0` là không tự chạy (collect: chỉ chạy khi bấm nút; answer: trả lời ngay từng tin) |
| `trigger.hintAfterSeconds` | số nguyên 0 hoặc 1–599, nhỏ hơn `quietSeconds` | `0` (tắt) | Sau số giây này không có ảnh hay tin mới, gửi tin `hint` báo sẽ làm gì tiếp và khi nào, rồi **cứ sau từng ấy giây lại cập nhật số giây còn lại** (25, 20, 15, … trong cùng một tin khi kênh sửa được tin; kênh không sửa được như Zalo chỉ báo một lần mỗi lượt im lặng). Có ảnh mới thì đếm lại; tới lúc bắt đầu thì dừng |
| `hint` | chuỗi mẫu, tối đa 500 ký tự | `Nếu không còn ảnh nào thì sau {remaining} giây sẽ tiến hành.` | Tin báo trên. `{remaining}` = `quietSeconds` − `hintAfterSeconds` (số giây còn lại tới lúc bắt đầu) |
| `trigger.button` | bool | `true` | Cho phép 🔍 Kiểm kê / `/kiemke` chạy ngay. `false`: không có nút Kiểm kê trong chat, `/kiemke` trả lời "không cần bấm", `/start` chỉ in hướng dẫn ngắn và gỡ bàn phím cố định cũ (có nút Kiểm kê) của người dùng. `collect` với `quietSeconds: 0` mà `button: false` là lỗi (không bao giờ chạy) |
| `status` | bool | `true` | `false`: chat không nhận tin trạng thái "📋 Lô … Đang nhận file / Đã xong" của phiên (thẻ trong ứng dụng BotTeam vẫn cập nhật). Lỗi vẫn được báo |
| `save.path` | mẫu đường dẫn tương đối, tối đa 200 ký tự, kết thúc bằng `/` | `"jobs/{session}/"` | Thư mục lưu ảnh của phiên (mục 4.5) |
| `save.texts` | bool | `true` | Ghi tin nhắn chữ của phiên vào `{folder}messages.md` |
| `save.phases` | ánh xạ `TênThưMục: [từ khóa…]` | không có | Cần khi mẫu có `{phase}`. Ví dụ `Truoc: [trước, truoc]`, `Sau: [sau]` |
| `save.machines` | tên file trong thư mục làm việc | `machines.md` | Cần khi mẫu có `{machine}` |
| `save.stage` | bool | `false` | `true`: ảnh được giữ tạm trong `jobs/_inbox/<phiên>/` tới khi phiên bắt đầu; lúc đó mới gửi `run.start` rồi chuyển từng ảnh vào thư mục theo chú thích của chính nó |
| `save.unknown` | `ask` \| `inbox` | `ask` | Khi không tách được `{machine}` hoặc `{phase}` từ chú thích. `ask`: hỏi lại người gửi, ảnh nằm chờ trong `jobs/_inbox/{session}/`. `inbox`: để ở đó và vẫn chạy |
| `ack` | chuỗi mẫu, tối đa 500 ký tự, rỗng là không gửi | như mẫu | Báo tiến trình khi đang nhận ("Đang nhận: 3 ảnh"): một tin, **sửa tại chỗ** khi kênh sửa được tin (Telegram), tin mới cách nhau vài giây khi không (Zalo). Số cuối cùng luôn được gửi |
| `run.prompt` | chuỗi mẫu, tối đa 4000 ký tự | như mẫu | Lời nhắc cho bot khi phiên chạy. Thay cho ô "What the bot is told for each batch" |
| `run.start` | chuỗi mẫu, tối đa 500 ký tự | rỗng | Tin gửi khi phiên bắt đầu (hết thời gian chờ hoặc bấm Kiểm kê), **trước** khi lưu ảnh vào thư mục khi có `save.stage`. Ví dụ "Đã nhận đủ {photos} ảnh. Bắt đầu lưu file…" |
| `run.agent` | bool | `true` | `false`: hết phiên thì **không chạy bot** và không cần file kết quả; chỉ gửi `run.reply` cho người gửi (và chat nhận kết quả) rồi đóng phiên. Không tốn lượt AI |
| `run.reply` | chuỗi mẫu, tối đa 1000 ký tự | `Đã nhận đủ {photos} ảnh và lưu vào folder:
{summary}` | Câu trả lời khi `run.agent: false`. Dùng được mọi biến, thêm `{summary}` |
| `run.command` | danh sách chuỗi mẫu | không có | Chạy sau khi lưu ảnh, **một lần cho mỗi máy** của phiên, không qua shell. Phần tử đầu là `{python}` (Python của BotTeam, có sẵn Playwright) kèm script, hoặc một chương trình; script/chương trình phải nằm **trong thư mục làm việc**. Biến: các biến của `save.path` (trừ `{phase}`), `{machine_folder}` (thư mục của máy, bỏ đoạn `{phase}` cuối), `{workdir}`, `{python}`. Mã thoát 0 = xong (dòng cuối in ra được gửi lại), 3 = chưa có dữ liệu (thử lại), khác = lỗi (cũng thử lại) |
| `run.retryMinutes`, `run.retryHours` | 1–1440; 0–48 | `10`; `3` | Thử lại `run.command` sau mỗi N phút, tối đa M giờ. Lần đầu chưa xong thì báo người gửi một lần; quá hạn thì báo **chat nhận kết quả** (người theo dõi, đặt ở tab Input). Việc chờ thử lại được lưu trong cơ sở dữ liệu nên vẫn tiếp tục sau khi server khởi động lại |
| `run.commandTimeoutSec` | 10–3600 | `300` | Một lần chạy quá thời gian này thì bị dừng (tính như lỗi, được thử lại) |
| `run.bot` | — | — | **Chừa sẵn, chưa làm**: giao phiên cho bot khác |
| `limits.maxPhotos` | 1–100 | `40` | Như hiện nay |
| `limits.timeoutSec` | 5–7200 | `900` | Như hiện nay |
| `limits.retentionDays` | 1–365 | `60` | Như hiện nay; xóa thư mục phiên cũ hơn số ngày này. Chỉ xóa thư mục do chính BotTeam tạo cho phiên (ghi trong `intake.json`) |
| `limits.remindAt` | `HH:MM` hoặc rỗng | rỗng | Như hiện nay |

Trường lạ được bỏ qua, kèm cảnh báo trong tab Input. Kiểu sai hoặc giá trị ngoài giới hạn là lỗi (mục 7).

### 4.4 Ở file hay ở giao diện

| Ở `intake.md` (người viết quy trình) | Ở tab Input (người giữ tài khoản) |
|---|---|
| mode, trigger, save, ack, run, limits | **Chat nào được dùng bot** (`chats`, cả `*`) |
| | **Chat nào nhận file kết quả** (`adminChats`) |

Ai được nói chuyện với bot là quyền truy cập. Bot ở mức Full có thể tự sửa file trong thư mục làm việc, nên quyền này **không bao giờ đặt trong file**: bot không được tự mở rộng ai được dùng nó. Riêng `*` vẫn chỉ cho phép khi `mode: answer` (như hiện nay); kiểm tra lúc lưu quyền và mỗi lần đọc lại `intake.md`.

### 4.5 Biến trong mẫu

| Biến | Dùng trong | Giá trị |
|---|---|---|
| `{session}` | path, ack, prompt | `session_id` của phiên |
| `{dd}`, `{mm}`, `{yyyy}` | path, ack, prompt, command | Ngày của phiên tách ra, ví dụ `{dd}.{mm}` = `19.11` |
| `{area}`, `{code}` | path, ack, prompt, command | Cột "Khu vực" và "Mã máy" của máy trong `machines.md`. Máy chưa có khu vực thì vào thư mục `Chưa có khu vực` (file được cảnh báo) |
| `{date}` | path, prompt | Ngày giờ Việt Nam (`Asia/Ho_Chi_Minh`) lúc nhận tin đầu, `YYYY-MM-DD` |
| `{time}` | path, prompt | `HHMMSS` lúc nhận tin đầu |
| `{chat}` | path, prompt | Mã chat |
| `{machine}` | path, ack, prompt | Tên chuẩn trong `machines.md` khớp với chú thích (mục 6) |
| `{phase}` | path, ack, prompt | Tên thư mục trong `save.phases` khớp với chú thích |
| `{folder}` | ack, prompt | Thư mục đầu tiên của phiên, tương đối với thư mục làm việc, có `/` ở cuối. Kết quả `out/` nằm ở đây (`{folder}out/`) |
| `{folders}` | ack, prompt | Mọi thư mục của phiên, mỗi dòng một thư mục (khi mẫu có `{machine}`/`{phase}` có thể nhiều hơn một) |
| `{saved}`, `{skipped}`, `{skipped_note}` | ack, prompt, reply, start | Số ảnh đã lưu mới, số ảnh bỏ qua vì folder đã có file giống hệt, và câu "Bỏ qua N ảnh đã có sẵn trong folder (giống hệt)." (rỗng khi không bỏ qua ảnh nào) |
| `{summary}` | ack, prompt, reply | Ảnh đã vào đâu, để đưa vào tin nhắn: một thư mục thì là đường dẫn (viết kiểu Windows, `BH FLEX M16-11-18\Truoc`); nhiều thư mục thì mỗi dòng `đường dẫn: N ảnh` |
| `{photos}`, `{texts}` | ack, prompt | Số ảnh, số tin chữ của phiên |
| `{quietSeconds}` | ack | Giá trị cấu hình |
| `{sender}` | prompt | Tên người gửi. **Chỉ dùng trong `prompt`, không dùng trong path** |

Biến lạ để nguyên dạng `{x}` (như `_Safe` hiện nay). Giá trị đưa vào path được làm sạch:
- bỏ `/ \ : * ? " < > |`, ký tự điều khiển, `..`, dấu chấm và khoảng trắng ở đầu hoặc cuối;
- giữ dấu tiếng Việt;
- tối đa 80 ký tự mỗi đoạn.

## 5. Thư mục làm việc và tạo `intake.md`

### 5.1 Thư mục làm việc mặc định khi tạo bot

- Tạo bot mà **không nhập thư mục làm việc** (và cài đặt mặc định cho bot mới cũng không có) thì server gán và tạo `<thư mục chạy>/workspaces/<bot_id>/`.
  - **Thư mục chạy** lấy từ thư mục hiện hành của tiến trình server lúc khởi động (`Path.cwd()`). Với `start.bat` / `pnpm dev` / `pnpm start:one` đó là gốc repo, ví dụ `D:\hungnm\github\aiBotTeam\workspaces\bot_9bdd900b24a1\`.
  - Biến môi trường `BOTTEAM_WORKSPACES` (tùy chọn) đổi thư mục cha `workspaces/`, dùng cho Docker hoặc khi chạy `botteam serve` từ nơi khác.
- Áp dụng cho mọi đường tạo bot: cửa sổ New bot, Administrator, `POST /api/bots`, nhập bot từ file, nhập team.
- Nhân bản bot (`/duplicate`) giữ thư mục của bot gốc như hiện nay. Nếu bot gốc không có thư mục, bản sao được gán thư mục mới theo quy tắc trên.
- Cửa sổ New bot đổi chữ gợi ý ô Working folder thành "Để trống: BotTeam tạo thư mục workspaces/<mã bot>".
- `workspaces/` được thêm vào `.gitignore` và bị bỏ qua trong `zip-project.ps1` (là dữ liệu, không phải mã).
- Bot cũ chưa có thư mục làm việc **không** bị gán khi khởi động; chỉ được gán khi thêm input (5.2) hoặc khi chuyển đổi (mục 9).

### 5.2 Tạo `intake.md` khi thêm input

- Khi cấp input cho bot (`PUT /api/channels/{app}/accounts/{id}/grants/{bot}` tạo quyền mới):
  1. Bot chưa có thư mục làm việc thì gán và tạo theo 5.1.
  2. Thư mục làm việc **chưa có** `intake.md` thì tạo file mặc định (mục 4.2). Chọn biến thể `collect` hay `answer` theo chế độ chọn trong hộp thoại cấp quyền.
  3. Đã có `intake.md` thì **giữ nguyên**, chỉ kiểm tra. File không hợp lệ thì quyền vẫn được lưu nhưng ở trạng thái "cần sửa intake.md" và không chạy (mục 7).
- Không tạo `intake.md` lúc tạo bot. Bot không có input thì không có file.
- Đổi thư mục làm việc của một bot đang có input: nếu thư mục mới chưa có `intake.md` thì tạo mặc định ở đó.
- Tạo file thất bại (thư mục không ghi được) thì từ chối cấp quyền với 400, nêu lý do.

## 6. `machines.md` và khớp tên máy (tùy chọn)

Chỉ dùng khi `save.path` có `{machine}`. Định dạng là một bảng Markdown; dòng tiêu đề nhận theo tên cột, không theo thứ tự:

```markdown
| Tên chuẩn  | Mã máy     | Tên gọi khác        |
|------------|------------|---------------------|
| BH FLEX M1 | 1000000342 | flex m1, may flex 1 |
```

Cách khớp chú thích "Máy BH Flex M1 trước":

1. **Chuẩn hóa:** chữ thường, bỏ dấu, bỏ từ "máy"/"may", gộp khoảng trắng.
2. **Tách giai đoạn:** tìm từ khóa của `save.phases` (sau khi chuẩn hóa), lấy ra làm `{phase}`. Phần còn lại là tên máy.
3. **So tên máy với tên chuẩn, mã máy và tên gọi khác:**
   - Phần chữ được so gần đúng.
   - **Mọi con số phải khớp đúng:** M1 không bao giờ khớp M10 hay M2.
   - Nhận khi điểm cao **và** hơn hẳn máy thứ hai.
   - Mơ hồ hoặc điểm thấp thì xử lý theo `save.unknown`. Với `ask`, bot trả lời kèm 2–3 tên gần nhất.
4. **Album:** ảnh không có chú thích dùng `{machine}` và `{phase}` của ảnh có chú thích gần nhất trước nó trong cùng phiên. Với Telegram thì theo cùng `media_group_id` trước.
5. Tin chữ riêng như "BH FLEX M1 sau" (không kèm ảnh) đặt `{machine}`/`{phase}` cho các ảnh **sau đó** trong phiên.

`machines.md` hỏng hoặc thiếu mà mẫu cần `{machine}` thì là lỗi của `intake.md`.

## 7. Đọc, kiểm tra và lỗi

- **Đọc lại khi file đổi** (theo thời điểm sửa), tối đa một lần mỗi giây. Không cần khởi động lại.
- **Lưu kết quả kiểm tra hợp lệ gần nhất:**
  - File sai sau khi đã từng đúng: **vẫn chạy theo bản đúng gần nhất**, tab Input báo lỗi kèm số dòng. Người gửi tin không thấy gì khác.
  - Chưa từng có bản đúng (file sai từ đầu, hoặc bị xóa): phiên mới vẫn được gom nhưng **không chạy**. Người gửi nhận "Bot đang được cấu hình, vui lòng thử lại sau", và chat quản trị (`adminChats`) nhận một tin báo lỗi, tối đa mỗi giờ một lần.
  - File bị xóa sau khi đã có: **không tự tạo lại** (chủ bot có thể cố ý xóa). Tab Input có nút **Tạo lại mặc định**.
- **API mới** `GET /api/bots/{id}/intake` trả về:
  ```
  { path, exists, valid, error?, line?, warnings[], effective: {…các trường sau khi áp mặc định…}, usingLastGood: bool }
  ```
  `POST /api/bots/{id}/intake/default` tạo file mặc định, chỉ khi chưa có (409 nếu đã có). Các API đọc và ghi nội dung file ở mục 7a. Không API nào nhận đường dẫn từ trình duyệt hay trả đường dẫn ngoài thư mục làm việc.

## 7a. Sửa `intake.md` trong Bot settings

### Vị trí và cách hiện

- Trong panel bot → **Bot settings**, ngay dưới phần **Inputs** (`BotInputs`), thêm mục **"Quy trình nhận tin (intake.md)"**, cùng kiểu `Field` với các mục khác (nhãn chữ hoa nhỏ, chữ gợi ý bên dưới).
- Mục này luôn hiện với bot có thư mục làm việc, có hoặc chưa có input:
  - **Có file, hợp lệ:** tóm tắt một hai dòng, ví dụ "Tự chạy sau 30 giây im lặng · lưu vào jobs/{session}/", kèm nút **Sửa**.
  - **Có file, có lỗi:** dòng lỗi màu đỏ kèm số dòng; nếu đang chạy theo bản đúng gần nhất thì ghi rõ. Nút **Sửa**.
  - **Chưa có file:** "Chưa có intake.md. File được tạo khi bot được thêm input." Nút **Tạo từ mẫu** tạo ngay file mặc định (người dùng tự chọn, không trái quyết định 2 vì đây không phải tạo tự động).
  - **Bot không có thư mục làm việc** (bot cũ): "Bot chưa có thư mục làm việc", không có nút.
- Panel chỉ rộng 320px nên **Sửa** mở hộp thoại riêng, cùng kiểu với hộp thoại sửa skill (`skill-editor`) nhưng rộng hơn: tối đa 760px, cao 90vh. Trên điện thoại thì chiếm toàn màn hình.

### Hộp thoại sửa

```
┌ Quy trình nhận tin · <tên bot> ───────────────────────────── ✕ ┐
│ [ intake.md ] [ machines.md ]                                    │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ ---                                                          │ │
│ │ format: botteam.intake                     (vùng soạn thảo,  │ │
│ │ ...                                         chữ đơn cách,    │ │
│ │ ---                                         có số dòng)      │ │
│ └──────────────────────────────────────────────────────────────┘ │
│ ✓ Hợp lệ: tự chạy sau 30 giây · lưu vào jobs/{session}/          │
│   hoặc  ✗ Dòng 7: quietSeconds phải từ 10 đến 600                │
│ [Khôi phục mẫu]                       [Hủy]  [Kiểm tra]  [Lưu]   │
└──────────────────────────────────────────────────────────────────┘
```

- **Hai thẻ:**
  - `intake.md` luôn có.
  - `machines.md` hiện khi file đó tồn tại hoặc `intake.md` dùng `{machine}`. Thẻ này có nút "Tạo bảng mẫu" khi chưa có file.
- **Vùng soạn thảo:** `textarea` chữ đơn cách, có cột số dòng, tab chèn 2 khoảng trắng. Không dùng thư viện soạn thảo ngoài.
- **Kiểm tra:**
  - Tự chạy sau mỗi lần ngừng gõ 600 ms, và khi bấm **Kiểm tra**.
  - Server kiểm tra nội dung đang soạn mà không ghi file.
  - Hiện ngay dưới vùng soạn thảo: hợp lệ thì tóm tắt quy trình; lỗi thì số dòng và lý do, bấm vào thì nhảy tới dòng đó; cảnh báo (trường lạ, `*` với `collect`) màu vàng.
- **Lưu:**
  - Chỉ bật khi nội dung đã đổi **và** hợp lệ. Không lưu được file sai từ giao diện; sửa tay ngoài app vẫn có thể ra file sai, và mục 7 xử lý trường hợp đó.
  - Lưu xong thì đóng hộp thoại, mục tóm tắt cập nhật, và quy trình mới áp dụng từ phiên kế tiếp. Phiên đang gom tiếp tục theo bản cũ cho tới khi chạy.
- **Khôi phục mẫu:** thay nội dung trong vùng soạn thảo bằng file mặc định (collect hoặc answer theo input hiện có). Chưa ghi gì cho tới khi bấm Lưu.
- **Hủy, ✕, Esc:** nếu có thay đổi chưa lưu thì hỏi "Bỏ thay đổi?".
- **Xung đột:** bot ở mức Full hoặc người dùng có thể sửa file ngoài app trong lúc hộp thoại mở.
  - Lưu gửi kèm mã băm nội dung lúc mở. File đã đổi thì server trả 409, hộp thoại báo "File đã được sửa ở nơi khác".
  - Hai lựa chọn: **Tải lại** (bỏ bản đang soạn) hoặc **Ghi đè** (giữ bản đang soạn, phải bấm xác nhận).
- **Phím tắt:** Ctrl/Cmd+S lưu, Esc đóng.

### API

| Phương thức | Đường dẫn | Việc |
|---|---|---|
| `GET` | `/api/bots/{id}/intake/file?name=intake.md\|machines.md` | `{ name, exists, content, hash, size }`. Không có file thì `exists: false`, `content: ""` |
| `POST` | `/api/bots/{id}/intake/check` | Thân `{ name, content }`. Trả `{ valid, error?, line?, warnings[], summary, effective? }`. Không ghi gì. Với `intake.md`, kiểm tra cả `machines.md` hiện có trên đĩa nếu mẫu cần |
| `PUT` | `/api/bots/{id}/intake/file` | Thân `{ name, content, hash, force? }`. Kiểm tra lại; sai thì 400 kèm lỗi và dòng. `hash` khác file hiện tại mà không có `force: true` thì 409. Ghi thì phát sự kiện để tab Input và Bot settings cập nhật |
| `POST` | `/api/bots/{id}/intake/default` | Như mục 7: tạo `intake.md` mặc định khi chưa có |

- `name` chỉ nhận đúng hai giá trị `intake.md`, `machines.md`. Đường dẫn file luôn là `<cwd của bot>/<name>`, không ghép gì từ trình duyệt.
- **Ghi an toàn:** ghi vào file tạm cùng thư mục rồi đổi tên, nên không bao giờ để file ghi dở. Mã hóa UTF-8, giữ kiểu xuống dòng của file cũ (CRLF hay LF).
- **Giới hạn:** `intake.md` 64 KB, `machines.md` 256 KB / 2.000 dòng (như mục 10).
- **Quyền:** cùng cổng xác thực với mọi `/api` (ghép nối khi truy cập bằng tên miền). Không cần thêm quyền riêng vì người mở được Bot settings đã sửa được chỉ dẫn và thư mục của bot.
- **Nhật ký:** mỗi lần lưu ghi một dòng vào nhật ký server: bot, tên file, kích thước, có ghi đè xung đột hay không. Không ghi nội dung.

## 8. Luồng xử lý (`mode: collect`)

```
tin tới ──► kiểm tra quyền chat (tab Input) ──► không có quyền: như hiện nay (/id vẫn trả mã chat)
   │
   ▼
lấy phiên đang mở của (tài khoản, chat, người gửi) hoặc mở phiên mới (session_id)
   │
   ├─ ảnh  ─► tính {folder} từ save.path (+ machines/phases) ─► lưu ảnh vào <cwd>/<folder>
   │                                    └─ không tách được: save.unknown (ask | inbox)
   ├─ chữ  ─► nếu là lệnh (/kiemke, /huy, /id, /help…) thì xử lý như hiện nay
   │          còn lại: ghi vào {folder}messages.md (save.texts) và cập nhật machine/phase hiện tại
   │
   ├─► gửi ack (gom, tối đa một tin mỗi 5 giây mỗi phiên)
   └─► đặt lại đồng hồ im lặng = quietSeconds
                │
   hết giờ ─────┤◄──── hoặc bấm 🔍 Kiểm kê / /kiemke (button: true)
                ▼
   phiên chuyển sang queued ─► chạy bot một lượt:
       lời nhắc = run.prompt (đã điền biến) + phần thân intake.md + danh sách file (chú thích là dữ liệu, không phải mệnh lệnh)
       chỉ dẫn của bot (Instructions, AGENTS.md) áp dụng như mọi lượt
   ─► file trong {folder}out/ được gửi về chat nhận kết quả (như hiện nay)
```

Chi tiết:

- **Với mẫu mặc định**, ảnh nằm thẳng trong `jobs/<session_id>/` (không còn thư mục con `images/`). Tin chữ ở `jobs/<session_id>/messages.md`, kết quả ở `jobs/<session_id>/out/`.
- **Một phiên có thể có nhiều thư mục** khi mẫu có `{machine}`/`{phase}` (ví dụ cả `.../Truoc/` và `.../Sau/`). `{folder}` trong `run.prompt` khi đó là danh sách các thư mục, mỗi dòng một thư mục. File kết quả `out/` lấy từ thư mục đầu tiên.
- **Bản kê `intake.json`** (thay `batch.json`) nằm trong thư mục đầu tiên của phiên, gồm: ảnh, chú thích, người gửi, thời điểm, machine/phase đã nhận ra.
- **Đồng hồ sống qua khởi động lại:** mỗi phiên lưu `lastAt`. Khi server khởi động (và mỗi vòng bảo trì), phiên `collecting` có `now - lastAt >= quietSeconds` được chạy ngay.
- **Phiên đang chạy mà có tin mới:** tin mới mở phiên mới. Không đổi phiên đang chạy.
- **`mode: answer`:** giữ nguyên hành vi trả lời từng tin hiện nay. `quietSeconds` > 0 thì gom các tin của cùng chat trong khoảng đó thành một câu hỏi (ví dụ ảnh rồi chữ). Ảnh vẫn lưu theo `save.path`.

## 9. Chuyển bot đang có

Khi nâng cấp, với mỗi bot đang có quyền input:

1. **Bot chưa có thư mục làm việc** thì gán `<thư mục chạy>/workspaces/<bot_id>/` (mục 5.1). Ví dụ bot "Ugreen Tra cứu lô kiện".
2. **Bot chưa có `intake.md`** thì tạo:
   - Quyền chế độ `batch` → **file mặc định mới** (mục 4.2): chờ 30 giây, lưu vào `jobs/{session}/`. `run.prompt` lấy lời nhắc cũ của quyền nếu có, đổi `{job}/images/` và `{job}/files/` thành `{folder}`, `{job}/out/` thành `{folder}out/`, `{job}` còn lại thành `{folder}`. Không có lời nhắc cũ thì dùng mặc định. `limits.*` lấy giá trị cũ.
   - Quyền chế độ `chat` → biến thể `answer` (`quietSeconds: 0`), hành vi giữ như cũ.
3. Ghi một dòng vào nhật ký server, và tab Input báo "Đã tạo intake.md từ cấu hình cũ".
4. Các cột `prompt`, `max_photos`, `timeout_sec`, `remind_at`, `retention_days`, `mode` của `channel_grants` giữ lại một phiên bản để quay lui, không đọc nữa, rồi xóa ở bản sau.

**Bot "Kiểm kê máy bán hàng"** (`bot_9bdd900b24a1`, thư mục `D:/hungnm/outsource/duchien/maybanhang_03/workspace`) chuyển hẳn sang cách mới:

- Được tạo `intake.md` mặc định (30 giây, `jobs/{session}/`), hoặc theo mẫu `{machine}/{date}/{phase}/` với `machines.md` nếu chủ bot muốn.
- Ảnh không còn nằm trong `jobs/<id>/images/` mà nằm thẳng trong `jobs/<id>/`. Vì vậy **phải cập nhật cùng lúc** các chỗ trong thư mục làm việc đang giả định `images/`: `AGENTS.md`, `skill_src/SKILL.md`, `tools/prepare.py` (và mọi script đọc `{job}/images`). Đây là một bước của việc triển khai, làm và kiểm cùng bản nâng cấp.
- Các lô đang mở lúc nâng cấp được chạy xong theo cách cũ. Lô mới đi theo cách mới.

## 10. An toàn

- **Đường dẫn:** mọi `{folder}` sau khi điền biến phải nằm trong `cwd`.
  - Kiểm tra bằng đường dẫn đã giải (resolve, kể cả symlink và junction trên Windows).
  - Ngoài `cwd` thì là lỗi: phiên vào `jobs/_inbox/{session}/` và báo quản trị.
  - Không cho đường tuyệt đối, ổ đĩa, `..`.
- **Thư mục mặc định `workspaces/<bot_id>/`** được tạo với `bot_id` do server sinh (không lấy từ tên bot), nên không có ký tự lạ. Không bao giờ dùng thư mục chạy làm `cwd` của bot.
- **Chú thích và tin chữ là dữ liệu từ bên ngoài:** chỉ dùng để chọn tên trong `machines.md`/`save.phases`, không bao giờ đổi quy trình. Chỉ `{session}`, `{date}`, `{time}`, `{chat}` và tên chuẩn đã khớp được vào path, không có chữ tự do của người gửi.
- **Quyền truy cập ở giao diện** (mục 4.4): bot sửa `intake.md` không mở rộng được ai dùng nó.
- **Mức duyệt:** chạy tự động thì không ai bấm duyệt; bot cần mức đủ cho việc trong chỉ dẫn (Full, theo quyết định cho bot của idrink). Tab Input hiện cảnh báo khi bot có input ở mức Full và nhận tin từ `*`.
- **Giới hạn:** dung lượng ảnh, số ảnh mỗi phiên, tốc độ tin, độ dài tin giữ như hiện nay. `intake.md` lớn hơn 64 KB hoặc `machines.md` lớn hơn 256 KB / 2.000 dòng là lỗi.
- **Xóa theo `retentionDays`:** chỉ xóa thư mục phiên mà `intake.json` ghi là do BotTeam tạo, không bao giờ xóa thư mục ngoài `jobs/` hay thư mục theo mẫu dùng chung nhiều phiên (ví dụ `BH FLEX M1/2026-11-18/Truoc/` chỉ bị xóa các file của phiên đó).

## 11. Thay đổi mã

**Server**

| File | Việc |
|---|---|
| `channels/intake.py` (mới) | Đọc phần đầu YAML, áp mặc định, kiểm tra (trả về lỗi kèm số dòng), điền mẫu, làm sạch đoạn đường dẫn, đọc `machines.md`, tách chú thích (machine, phase), khớp tên máy (số khớp đúng), bộ nhớ đệm theo thời điểm sửa và bản đúng gần nhất, sinh file mặc định (collect/answer) |
| `channels/service.py` | Tạo `intake.md` khi cấp quyền (5.2); lưu ảnh theo `{folder}` khi nhận; ghi `messages.md`, `intake.json`; ack có gom; đồng hồ im lặng mỗi phiên (asyncio, đặt lại theo tin) và chạy lại phiên quá hạn khi khởi động; lời nhắc từ `run.prompt` + thân file; chuyển bot cũ (mục 9) |
| `channels/db.py` | `channel_batches`: thêm `last_at`, `folders` (JSON), `machine`/`phase` hiện tại |
| `workspaces.py` (mới) | Thư mục chạy (ghi nhận lúc khởi động), `BOTTEAM_WORKSPACES`, tạo `workspaces/<bot_id>/` |
| `main.py` | `create_bot`, nhập bot/team, `duplicate` (khi bot gốc không có thư mục): gán thư mục mặc định; `patch_bot` (đổi `cwd` của bot có input): tạo `intake.md` nếu thiếu; route `GET /api/bots/{id}/intake`, `POST /api/bots/{id}/intake/default`, và các route đọc / kiểm tra / ghi file của mục 7a (ghi nguyên tử, kiểm tra mã băm) |
| `intake_template.md` (mới, trong gói) | Nội dung mặc định mục 4.2 (hai biến thể) |
| `wire.py` | Kiểu `WireIntake`; bỏ các trường đã chuyển khỏi `WireChannelGrant` (giữ đọc được một phiên bản) |

**Web**

| File | Việc |
|---|---|
| `InputChannels.tsx` | Trong mỗi quyền: bỏ các ô số ảnh, thời gian, giờ nhắc, lời nhắc (chế độ chỉ còn dùng để chọn biến thể khi tạo file). Thêm khung "Quy trình (intake.md)" tóm tắt chạy khi nào, lưu ở đâu, lỗi/cảnh báo, kèm nút **Mở file** và **Tạo lại mặc định** (chỉ khi file không tồn tại). Giữ ô chats và adminChats |
| `NewBotDialog.tsx` | Chữ gợi ý ô Working folder (mục 5.1) |
| `BotPanel.tsx` | Trong Bot settings, dưới Inputs: mục "Quy trình nhận tin (intake.md)" (tóm tắt, lỗi, nút Sửa / Tạo từ mẫu) |
| `IntakeEditor.tsx` (mới) | Hộp thoại sửa mục 7a: hai thẻ, vùng soạn thảo có số dòng, kiểm tra khi ngừng gõ, Lưu / Khôi phục mẫu / Hủy, xử lý xung đột 409, Ctrl+S |
| `lib/i18n-vi.ts` | Chữ mới |

**Khác:** `.gitignore` và `zip-project.ps1` bỏ qua `workspaces/`; `docs/user-guide.md` (mục Input), `README.md` (một dòng); ví dụ `intake.md` + `machines.md` cho bot kiểm kê máy bán hàng trong `docs/examples/`.

## 12. Kiểm thử

**Server (pytest, Telegram/Zalo giả):**

- **Thư mục làm việc:** tạo bot không nhập thư mục thì có `<thư mục chạy>/workspaces/<bot_id>/` (thử với `BOTTEAM_WORKSPACES` trỏ thư mục tạm); có nhập thì giữ nguyên; tạo bot **không** sinh `intake.md`.
- **Thêm input:** sinh `intake.md` khi chưa có (đúng biến thể collect/answer), không ghi đè file sẵn có, bot chưa có thư mục được gán thư mục, thư mục không ghi được thì 400.
- **Đồng hồ 30 giây** (thu nhỏ thời gian như `time_scale`): tin mới đặt lại; hết giờ thì chạy đúng một lượt; nút Kiểm kê chạy ngay; `quietSeconds: 0` chỉ chạy bằng nút; khởi động lại server mà phiên đã quá hạn thì chạy.
- **Lưu ảnh:**
  - Mặc định vào `<cwd>/jobs/<session_id>/`, tin chữ vào `messages.md`, kết quả từ `out/` được gửi về.
  - Mẫu `{machine}/{date}/{phase}/` với `machines.md`: tên gần đúng; số M1/M10 không lẫn; album không chú thích; tin chữ đặt máy cho ảnh sau.
  - `save.unknown: ask` hỏi lại và giữ ảnh ở `jobs/_inbox/`.
- **An toàn:** chú thích `../../x`, `C:\`, tên máy độc hại, `save.path` chứa `..` hoặc đường tuyệt đối, symlink ra ngoài. Không ghi ra ngoài `cwd`. `*` với `mode: collect` bị từ chối.
- **Lỗi file:** file sai sau khi đúng thì vẫn chạy theo bản đúng gần nhất và báo lỗi kèm số dòng; sai từ đầu thì không chạy và báo quản trị; file bị xóa thì không tự tạo lại.
- **Chuyển bot cũ:** quyền `batch` sinh file mặc định mới với lời nhắc cũ đã đổi `{job}`; quyền `chat` sinh biến thể `answer`; bot không có thư mục được gán thư mục.
- **`mode: answer`** vẫn đạt các test hiện có của `test_channel_chat.py`.

**Server, cho mục 7a:** đọc / kiểm tra / ghi file; `name` lạ (`../x`, `AGENTS.md`) bị từ chối; nội dung sai thì 400 kèm dòng và file không đổi; mã băm cũ thì 409, `force` thì ghi; ghi giữ CRLF/LF; quá giới hạn kích thước bị từ chối; lưu xong thì phiên kế tiếp dùng quy trình mới.

**Web (Vitest):** i18n đủ chữ. Kiểm tra tay bằng trình duyệt tự động: khung quy trình hiện đúng, lỗi hiện đúng, chữ gợi ý ô Working folder; trong Bot settings mở **Sửa**, đổi `quietSeconds` thành giá trị sai thì thấy lỗi đúng dòng và nút Lưu tắt; sửa đúng thì Lưu, tóm tắt cập nhật; sửa file trên đĩa trong lúc mở thì Lưu báo xung đột.

**Thật:** một lần với tài khoản Telegram thật trên bot kiểm kê máy bán hàng: gửi 3 ảnh, chờ 30 giây, ảnh nằm trong `jobs/<session_id>/` và bot chạy xong việc kiểm kê với các script đã cập nhật.

## 13. Tiêu chí hoàn thành

1. Tạo bot mà không nhập thư mục (giao diện, Administrator, API) thì luôn có `<thư mục chạy>/workspaces/<bot_id>/`. Tạo bot không sinh `intake.md`.
2. Thêm input cho bot mà thư mục chưa có `intake.md` thì có file mặc định đúng mục 4.2. File sẵn có không bị đổi.
3. Bot có input mà `intake.md` không hợp lệ thì không chạy, và giao diện nói rõ lý do kèm số dòng.
4. Với file mặc định: gửi ảnh, 30 giây không gửi thêm, thì ảnh nằm trong `<cwd>/jobs/<session_id>/` và bot chạy đúng một lượt theo chỉ dẫn của nó.
5. Đổi `quietSeconds` hoặc `save.path` trong file có hiệu lực từ phiên kế tiếp, không cần khởi động lại.
6. Mẫu `{machine}/{date}/{phase}/` với `machines.md` xếp đúng ảnh trước/sau, kể cả album và tên gõ gần đúng. Không bao giờ ghi ra ngoài thư mục làm việc.
7. Bot kiểm kê máy bán hàng chạy theo cách mới (30 giây, `jobs/<session_id>/`) và cho ra kết quả kiểm kê như trước. Bot Ugreen (trả lời từng tin) hoạt động như trước.
8. Trong Bot settings xem được quy trình đang dùng, mở hộp thoại sửa `intake.md` (và `machines.md`), thấy lỗi kèm số dòng trước khi lưu, không lưu được nội dung sai, và không ghi đè mất thay đổi làm ở nơi khác mà không được hỏi.
9. Toàn bộ test server, web, dịch vụ Zalo đạt.

## 14. Quyết định đã chốt (2026-11-18)

| # | Câu hỏi | Quyết định |
|---|---|---|
| 1 | Thư mục phiên mặc định | `jobs/{session}/` |
| 2 | Khi nào tạo `intake.md` | Khi bot được thêm input, và chỉ khi thư mục làm việc chưa có file. Bot không có input thì không tạo |
| 3 | Bot kiểm kê máy bán hàng khi nâng cấp | Chuyển sang cách mới (30 giây, `jobs/{session}/`), cập nhật script trong thư mục làm việc cùng lúc |
| 4 | Thư mục làm việc khi tạo bot không nhập | `<thư mục chạy>/workspaces/<bot_id>/` |
| 5 | Mức duyệt bot của idrink | Full |
| 6 | Sửa `intake.md` ở đâu | Trong Bot settings, dưới Inputs; hộp thoại sửa nội dung file (cả `machines.md`), có kiểm tra trước khi lưu (mục 7a) |

## 15. Khác với bản nháp (khi làm)

- **`{folder}` và `{folders}`:** `{folder}` là thư mục đầu tiên (nơi có `out/`), `{folders}` là danh sách mọi thư mục. Bản nháp để `{folder}` là cả danh sách, nhưng như vậy `{folder}out/` sai khi có nhiều thư mục.
- **Không lưu file trùng:** trước khi ghi một file vào thư mục, server kiểm thư mục đó đã có file **giống hệt nội dung** (cùng dung lượng, cùng mã băm SHA-256) chưa; có rồi thì không lưu lần nữa, bản kê trỏ tới file đã có và đánh dấu `duplicate`. Chỉ giống từng byte mới tính là trùng: cùng một ảnh gửi lại qua Telegram nén lại thì có thể khác byte. Dọn theo `retentionDays` không xóa file của một phiên khác mà phiên này chỉ trỏ tới.
- **Thư mục riêng của phiên luôn là `jobs/<phiên>/`:** `intake.json`, `batch.json`, `messages.md` và `out/` nằm ở đó, không nằm lẫn trong thư mục ảnh của mẫu `save.path` (thư mục ảnh chỉ chứa ảnh). Biến `{out}` trỏ tới `jobs/<phiên>/out/`; lời nhắc mặc định dùng `{out}`.
- **Bản kê:** server ghi cả `intake.json` (tên mới) lẫn `batch.json` (tên cũ, cùng nội dung) để các script cũ trong thư mục làm việc vẫn đọc được.
- **Thư mục làm việc mặc định:** khi ứng dụng được dựng với thư mục dữ liệu riêng (test, nhúng), thư mục cha là `<thư mục dữ liệu>/workdirs`, không phải thư mục chạy, để không tạo gì ở nơi chương trình tình cờ chạy. Bộ nhớ của bot vẫn ở `<dữ liệu>/workspaces/` và khác với thư mục làm việc.
- **Chế độ `answer`:** hiện bỏ qua `save.*` (ảnh vẫn được lưu vào kho đính kèm của cuộc trò chuyện như trước); chỉ `mode`, `limits.timeoutSec` có tác dụng.
- **Thư mục `out/` của phiên nhiều thư mục:** nằm cạnh thư mục đầu tiên, như mục 8.
- **Tạo `intake.md` khi cấp quyền:** chỉ tạo sau khi mọi kiểm tra của yêu cầu đã qua (một yêu cầu bị từ chối không để lại file).
- **Thẻ trạng thái và tin xác nhận** trong chat nói rõ "tự chạy sau N giây không có tin mới" khi `quietSeconds` > 0.
- **Việc làm cùng lúc cho bot kiểm kê máy bán hàng:** `AGENTS.md`, `skill_src/SKILL.md`, `.claude/skills/.../SKILL.md` và `tools/prepare.py` trong thư mục làm việc đã đổi sang bố cục mới (ảnh và PDF nằm thẳng trong thư mục lô; `prepare.py` đọc cả `files/` của lô cũ). Khi server khởi động lần đầu với bản này, bot được tạo `intake.md` từ cấu hình cũ (lời nhắc cũ giữ lại, `{job}` đổi thành `{folder}`).
