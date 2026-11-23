# Thiết lập OpenSandbox

Computer use mặc định tắt. Với OpenSandbox, máy tính ảo của mỗi agent là một container Docker có màn hình desktop, do một máy chủ OpenSandbox mà bạn tự chạy trên máy Linux tạo ra. Chỉ cần Docker: không cần KVM, không cần máy ảo. BotTeam nói chuyện với địa chỉ máy chủ và khoá API (nếu bạn đặt). Chọn OpenSandbox (Docker) trong Cài đặt → Computer Use, và chỉ bật Computer use cho một agent sau khi phép thử kết nối báo máy chủ đã sẵn sàng.

BotTeam cần Python 3.11 trở lên cho tính năng tuỳ chọn này, giống như với E2B.

## Trước khi bắt đầu

Bạn cần một máy chủ Linux có Docker Engine 27 trở lên, còn trống khoảng 3 GB đĩa cho image desktop, và truy cập ra Docker Hub, kho gói của Ubuntu và kho Chrome của Google trong lúc dựng image. Mỗi máy tính ảo là một container, nên dự trù 1–2 GB bộ nhớ cho mỗi máy đang chạy.

Container chỉ cách ly máy tính ảo khỏi máy chủ của bạn ở mức Docker cách ly. Các máy này mở những trang web chưa ai kiểm tra, nên hãy đọc phần cách ly mạnh hơn ở cuối trước khi để đăng nhập trên chúng.

## Cài máy chủ OpenSandbox

Cài uv, rồi để nó tải máy chủ và ghi cấu hình cho Docker. Lần chạy đầu tải máy chủ cùng các gói phụ thuộc, mất vài phút nếu mạng chậm.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
~/.local/bin/uvx opensandbox-server init-config ~/.sandbox.toml --example docker
```

Mở `~/.sandbox.toml` và đặt các giá trị sau trong mục `[server]`. Dùng địa chỉ mà BotTeam kết nối tới, đừng dùng `0.0.0.0` trên mạng bạn không tin cậy, và tạo khoá dài bằng `openssl rand -hex 24`.

```toml
[server]
host = "192.0.2.10"        # địa chỉ BotTeam kết nối tới (địa chỉ LAN hoặc Tailscale)
port = 8080
eip = "192.0.2.10:8080"    # địa chỉ đó KÈM cổng: máy chủ đưa nó vào các địa chỉ nó cấp ra
api_key = "osk_khoa-ngau-nhien-dai"

[egress]
mode = "dns+nft"          # giới hạn mạng của máy tính ảo ở tầng gói tin (xem bên dưới)
```

Nếu `eip` thiếu cổng, BotTeam không tới được màn hình các máy tính ảo. Với chế độ egress mặc định `dns`, máy chủ chỉ lọc theo tên miền nên không chặn được máy tính ảo truy cập địa chỉ riêng: BotTeam cần `dns+nft`. (Đã đo: với `dns+nft`, máy tính ảo không vào được 192.168.x.x, địa chỉ của chính máy chủ, cổng Docker hay máy khác trong mạng Tailscale, còn các trang web thì vào bình thường.)

Giữ tệp này riêng tư (`chmod 600 ~/.sandbox.toml`). Rồi chạy máy chủ như một dịch vụ để nó tự khởi động cùng máy. Thay `youruser` bằng người dùng thuộc nhóm `docker`.

```bash
sudo tee /etc/systemd/system/opensandbox.service >/dev/null <<'EOF'
[Unit]
Description=OpenSandbox server (Docker runtime)
After=network-online.target docker.service
Requires=docker.service

[Service]
User=youruser
Group=docker
Environment=PATH=/home/youruser/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/youruser/.local/bin/uvx opensandbox-server --config /home/youruser/.sandbox.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now opensandbox
curl http://192.0.2.10:8080/health
```

Lệnh cuối in `{"status":"healthy"}`. Khi đã đặt khoá, `curl -H "OPEN-SANDBOX-API-KEY: <khoá của bạn>" http://192.0.2.10:8080/v1/sandboxes` liệt kê các sandbox (chưa có cái nào), còn cùng yêu cầu đó không kèm khoá thì bị từ chối.

## Dựng image desktop

Image được dựng từ `docs/opensandbox-desktop` trong kho mã BotTeam. Chép thư mục đó sang máy chủ và dựng ở đó; lần dựng đầu tải Chrome và desktop, có thể mất mười phút hoặc hơn.

```bash
docker build -t botteam/desktop:1 docs/opensandbox-desktop
```

Image có desktop (Xvfb và XFCE), Chrome, `xdotool` và `scrot` cho chuột, bàn phím và ảnh chụp màn hình của agent, `xclip` để dán văn bản như tiếng Việt, và một luồng xem màn hình chỉ-xem. Dựng lại khi bạn muốn Chrome mới hơn.

## Kết nối BotTeam

Mở Cài đặt → Computer Use, chọn OpenSandbox (Docker), nhập địa chỉ máy chủ (`http://192.0.2.10:8080`), khoá API và tên image (`botteam/desktop:1`), rồi bấm Lưu và kiểm tra kết nối. Phép thử tạo một máy tính thật, kiểm tra công cụ desktop, chụp một ảnh màn hình rồi xoá máy đó, nên mất vài giây.

Kết quả là một trong: sẵn sàng; không có quyền (kiểm tra khoá); không kết nối được (kiểm tra địa chỉ, tường lửa và dịch vụ có đang chạy); không thấy image desktop (hãy dựng nó trên máy chủ); thiếu công cụ desktop (dựng lại image từ thư mục hiện tại); máy chủ không giới hạn được truy cập mạng của máy tính ảo (xem Khắc phục sự cố).

Chỉ cần cổng của máy chủ (8080) truy cập được từ máy chạy BotTeam. Màn hình các máy tính ảo được phát qua máy chủ kèm khoá API của bạn, nên không phải mở cổng nào khác.

## Điều cần biết

Khi máy tính ảo nhàn rỗi đủ thời gian bạn đặt, BotTeam đóng băng container tại chỗ (Docker pause). Cửa sổ đang mở và đăng nhập vẫn còn, và máy tỉnh lại sau vài giây. Container đóng băng vẫn giữ bộ nhớ, nên số máy phải phù hợp với RAM của máy chủ (khoảng 1–2 GB mỗi máy). Nếu máy chủ không đóng băng được, hoặc bạn khởi động lại hay xoá container, máy sẽ được tạo lại từ image và cửa sổ cùng đăng nhập sẽ mất: hãy đăng nhập lại bằng cách tiếp quản máy. E2B giữ được mọi thứ vì chụp bộ nhớ ra đĩa; OpenSandbox trên Docker chỉ giữ khi container còn tồn tại.

Mỗi máy bị chặn truy cập vào mạng riêng, vào máy chủ của bạn và máy chạy BotTeam. Nếu máy chủ OpenSandbox không áp dụng được điều đó, máy sẽ không được tạo.

## Cách ly mạnh hơn

Mặc định container dùng chung nhân với máy chủ. Với trang web không tin cậy, hãy chạy máy chủ OpenSandbox với gVisor hoặc Kata Containers: xem "Secure Container Runtime" trong tài liệu OpenSandbox (docs/guides/secure-container.md trong https://github.com/alibaba/OpenSandbox) và đặt `[secure_runtime]` trong `~/.sandbox.toml`. Kata cần KVM; gVisor thì không. Khởi động lại dịch vụ sau khi sửa tệp.

## Windows

Máy chủ OpenSandbox cần Linux. Trên Windows hãy chạy nó trong một bản Linux của WSL2 có Docker (Docker Desktop có tích hợp WSL dùng được) và làm theo các bước Linux ở đó. Điều này chưa được kiểm chứng trên mọi cấu hình Windows.

## Cập nhật và gỡ bỏ

Để cập nhật, chạy `sudo systemctl restart opensandbox` sau `~/.local/bin/uv tool upgrade opensandbox-server` (hoặc để `uvx` tải bản mới nhất). Để gỡ, hãy xoá các máy tính ảo trong BotTeam trước, rồi `sudo systemctl disable --now opensandbox`, xoá tệp dịch vụ, `docker rmi botteam/desktop:1` và xoá `~/.sandbox.toml`.

## Khắc phục sự cố

Không thấy image desktop: `docker images` trên máy chủ phải liệt kê `botteam/desktop:1`. Máy chủ tìm nó trong Docker của chính nó, rồi thử Docker Hub nơi nó không tồn tại.

Thiếu công cụ desktop: dựng lại image từ thư mục `docs/opensandbox-desktop` của phiên bản BotTeam này.

Máy chủ không giới hạn được truy cập mạng của máy tính ảo: container egress không khởi động được, hoặc `[egress] mode` không phải `dns+nft`. Xem `sudo journalctl -u opensandbox`, xem máy chủ có kéo được `opensandbox/egress` và `opensandbox/execd` từ Docker Hub không, và Docker có dùng mạng bridge không.

Màn hình máy tính ảo đen: desktop tắt screensaver khi máy khởi động. Nếu màn hình vẫn đen, hãy tiếp quản máy, nhấn một phím rồi báo agent.

Hết dung lượng đĩa: Docker giữ image và container đã dừng. Chạy `docker system df` và `docker image prune` trên máy chủ.
