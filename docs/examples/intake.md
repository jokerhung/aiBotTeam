---
format: botteam.intake
version: 1
mode: collect
trigger:
  quietSeconds: 30            # tự chạy khi 30 giây không có ảnh hoặc tin nhắn mới
  button: true                # vẫn cho bấm 🔍 Kiểm kê (hoặc gõ /kiemke) để chạy ngay
save:
  path: "{machine}/{date}/{phase}/"      # ví dụ: BH FLEX M1/2026-11-18/Truoc/
  phases:
    Truoc: [trước, truoc]
    Sau: [sau]
  machines: machines.md
  unknown: ask                # không nhận ra máy hoặc trước/sau: hỏi lại, ảnh chờ trong jobs/_inbox/
ack: "Đã nhận {photos} ảnh của {machine} ({phase}). Sẽ xử lý sau {quietSeconds} giây nếu không có thêm."
run:
  prompt: "Hậu kiểm ảnh trong {folders} theo AGENTS.md. File kết quả cần gửi lại thì ghi vào {folder}out/."
limits:
  maxPhotos: 60
  timeoutSec: 1800
  retentionDays: 60
---
# Quy trình nhận ảnh trước/sau khi nhập hàng

Nhân viên gửi ảnh qua Telegram kèm chú thích "Máy BH Flex M1 trước" hoặc "... sau". Ảnh trong cùng một lần gửi
(album) không có chú thích thì dùng chú thích của ảnh đầu. Sau 30 giây không có thêm gì thì bot hậu kiểm.
