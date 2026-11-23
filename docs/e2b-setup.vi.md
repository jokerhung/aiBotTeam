# Thiết lập E2B

Tính năng dùng máy tính mặc định tắt. BotTeam cần Python 3.11 trở lên để dùng tính năng tuỳ chọn này. Chọn E2B Cloud hoặc máy chủ E2B tự host tại Cài đặt → Dùng máy tính. Sau khi kết nối báo sẵn sàng, chọn Dùng máy tính trong cài đặt của agent có engine hỗ trợ ảnh từ công cụ.

Nếu BotTeam đang dùng Python 3.10, chạy `uv sync --project server --python 3.11` trong thư mục dự án rồi khởi động lại server trước khi bật chế độ dùng máy tính.

## E2B Cloud

Đăng ký tại https://e2b.dev và sao chép khoá API từ bảng điều khiển E2B. Chọn E2B Cloud, dán khoá rồi chọn Lưu và kiểm tra kết nối. Mẫu mặc định là `desktop`.

Ảnh màn hình và nội dung máy ảo được xử lý trên hạ tầng E2B. Xem giới hạn sử dụng, thời lượng phiên và giá trên gói E2B của bạn. Giữ khoá ở máy chủ BotTeam và dùng Tiếp quản khi cần đăng nhập trang web.

## Tự host trên Linux

Nếu chạy Linux trong máy ảo, hãy bật ảo hoá lồng nhau. E2B khuyến nghị Ubuntu 24.04, kernel 6.8 trở lên (6.10 với arm64), Docker Engine 27+, Compose 2.24+ và RAM 12 GiB. Kiểm tra `/dev/kvm` và `/dev/net/tun`. Dựng mẫu desktop cần nhiều đĩa hơn bản cài cơ bản. Lượt thử trên VMware cần hơn 40 GiB trống ở thời điểm cao nhất. Nên có ít nhất 50 GiB trống khi dựng mẫu đầy đủ và chừa chỗ lưu các máy đang tạm dừng.

```bash
ls -l /dev/kvm /dev/net/tun
docker version
docker compose version
df -h /
mkdir e2b && cd e2b
runtime=2c662b902d061bee7b88d408477bed5d05107934
curl -fsSL --remote-name-all "https://raw.githubusercontent.com/e2b-dev/runtime/$runtime/embed/compose/{compose.yaml,.env}"
docker compose up -d --wait
eval "$(docker compose exec ready cat /run/e2b/sdk.env)"
```

Nếu chưa có Docker Engine, cài theo https://docs.docker.com/engine/install/. Các lệnh Compose theo hướng dẫn của E2B. BotTeam đã thử với runtime E2B dựng từ mã nguồn trên máy VMware chạy Linux Mint có KVM.

Dựng mẫu desktop chính thức ngay trên máy chủ E2B để tải tệp mẫu lên được qua cổng cục bộ. Chạy trong shell đã có các biến SDK của E2B. Mức tài nguyên dưới đây đã dùng trong lượt thử VMware.

```bash
git clone https://github.com/e2b-dev/desktop.git
cd desktop
git checkout 91f23acaab7312e847596acc44e6f7763f56917f
python3 -m venv .venv
.venv/bin/pip install e2b==2.64.0
cd template
../.venv/bin/python - <<'PY'
from e2b import Template, default_build_logger
from template import template_with_user_workdir
Template.build(template_with_user_workdir, name="desktop", cpu_count=2,
               memory_mb=2048, on_build_logs=default_build_logger())
PY
```

Trong BotTeam, chọn E2B tự host. Nếu BotTeam chạy trên máy khác, nhập URL API ở cổng 3000 và URL proxy sandbox ở cổng 3002. Ví dụ `http://e2b-host:3000` và `http://e2b-host:3002` với tên miền tin cậy trong LAN hoặc Tailscale. Dán khoá E2B cục bộ và kiểm tra kết nối. Có thể để trống tên miền E2B khi dùng hai URL tường minh. Dùng trường tên miền khi đã định tuyến sandbox theo tên máy.

Chỉ mở các cổng API và proxy sandbox trong mạng tin cậy. Bảng điều khiển E2B tuỳ chọn dùng cổng 3001. Cổng 5008 dùng để tải mẫu khi dựng trên máy chủ E2B. BotTeam chuyển tiếp luồng hình qua địa chỉ web của ứng dụng.

## Tự host trên Windows

Bật ảo hoá trong firmware, bật WSL2, cài Docker Desktop ở chế độ WSL2 và bật tích hợp với Ubuntu 24.04. Tạo hoặc sửa `.wslconfig` trong thư mục người dùng Windows, đặt `memory=16GB` và `nestedVirtualization=true` trong mục `[wsl2]`. Chạy `wsl --shutdown` để áp dụng. Lệnh này dừng mọi bản phân phối WSL và container Docker đang chạy. Mở lại Docker Desktop và Ubuntu.

Trong Ubuntu, kiểm tra `ls -l /dev/kvm /dev/net/tun`. Nếu thiếu KVM, dùng máy Linux có KVM. Windows 10 trong lượt thử không có KVM trong WSL2, nên E2B chạy trên VMware Linux có bật ảo hoá lồng nhau. Khi đã có KVM, làm theo phần Linux trong Ubuntu.

## Tiếp quản và xử lý lỗi

Mở tab Máy tính của agent. Đánh thức để tạo hoặc khôi phục máy, rồi Mở rộng để xem màn hình trực tiếp. Tiếp quản cho phép dùng chuột và bàn phím từ trình duyệt và tạm ngưng các lệnh điều khiển của agent đến khi bạn chọn Trả quyền điều khiển. Xoá máy ảo trong cài đặt agent để xoá tệp và phiên đăng nhập. Kết thúc hoặc xoá chiến dịch cũng sẽ xoá máy ảo của nó.

Nếu thiếu mẫu, kiểm tra trạng thái dựng trong E2B. Nếu từng hết đĩa và lượt thử lại báo thiếu snapshot, dọn dung lượng và dựng lại với `skip_cache=True`. Nếu lỗi cấp hugepage, giảm số máy chạy đồng thời hoặc tăng `HUGEPAGES` trong cấu hình Compose. Với lỗi `Failed to UFFD object`, kiểm tra kernel và KVM. Nếu không thấy hình trực tiếp, kiểm tra proxy web BotTeam có hỗ trợ WebSocket và server có kết nối được cả hai URL E2B.

Khi cập nhật hoặc gỡ E2B, dùng hướng dẫn tương ứng với phiên bản đã cài tại https://github.com/e2b-dev/runtime/tree/2c662b902d061bee7b88d408477bed5d05107934/embed/compose.
