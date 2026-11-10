# Phase 1 — Nền móng và khung giao diện

**Mục tiêu:** mở app thấy đúng khung của bản gốc (sidebar, vùng chat, composer) chạy trên Next.js + shadcn, nối với backend Python qua HTTP + SSE, tạo/sửa/xoá bot được. Chưa có agent thật: bot trả lời bằng driver giả.

**Tham chiếu:** `src/App.tsx`, `src/styles.css`, `src/main.tsx`, `src/components/Sidebar*.tsx`, `ChatView.tsx`, `Composer.tsx`, `CursorAvatar.tsx`, `src/state/store.tsx`, `src/state/api.ts`, `shared/wire.ts`, `server/harness/bus.ts`. Ảnh: `docs/screenshots/hero.png`.

## 1. Dựng dự án

- [ ] `web/`: `create-next-app` (App Router, TS, Tailwind v4), `shadcn init`, thêm `lucide-react`, `clsx`, `tailwind-merge`, `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`, `@fontsource-variable/inter`.
- [ ] `server/`: `uv` + `pyproject.toml`; phụ thuộc `fastapi`, `uvicorn`, `sse-starlette`, `pydantic`, `aiosqlite`; dev: `pytest`, `pytest-asyncio`, `httpx`, `ruff`, `mypy`.
- [ ] `next.config.ts`: `rewrites` `/api/:path*` → `http://127.0.0.1:8899/api/:path*`. Kiểm SSE qua rewrite có bị đệm không; nếu có, `EventSource` gọi thẳng cổng 8899 và backend bật CORS cho `localhost:5299`.
- [ ] Script gốc: `dev` (chạy cả hai), `typecheck`, `test`, `gen:wire` (OpenAPI → `web/lib/wire.ts`).
- [ ] `.gitignore`: `_reference/`, `.next/`, `.venv/`, `node_modules/`.

## 2. Hệ thống thiết kế

- [ ] Chép `src/styles.css` sang `web/app/globals.css`; giữ `@theme`, 13 khối `[data-skin]`, `:root[data-chat-width]`, `:root[data-font]`, keyframes, thanh cuộn, focus.
- [ ] Nối biến shadcn vào token gốc theo bảng ở [README mục 4](README.md#4-chiến-lược-giao-diện-giống-hệt).
- [ ] `lib/skins.ts`, `lib/fonts.ts`, `lib/chat-width.ts`: đọc lựa chọn từ `localStorage`, áp vào `<html data-skin data-font data-chat-width>`.
- [ ] Chống nháy skin: script nội tuyến trong `app/layout.tsx` chạy trước lần vẽ đầu (bản gốc gọi `applySkinChoice` trước `createRoot`).
- [ ] Thêm primitive shadcn: `button`, `input`, `textarea`, `dialog`, `popover`, `dropdown-menu`, `context-menu`, `tooltip`, `scroll-area`, `sonner`. Ghi đè class cho khớp token (menu bo 12, hàng menu bo 6, nền `bg-menu`, hover `bg-menu-hover`).
- [ ] Chép mascot: `CursorAvatar.tsx`, `CarvedAvatar.tsx`, `Avatar.tsx`, `lib/mascot.ts`, `shared/mascot-bodies.ts` (12 màu `--identity-*`, biểu cảm).

## 3. Khung app (đúng bố cục gốc)

Cấu trúc `Shell` theo `App.tsx`:

```
<div class="flex h-full flex-col">
  [dải thông báo: mất kết nối, cập nhật]
  <div class="relative flex min-h-0 flex-1">
    <Sidebar/>            280px · bg-panel · viền phải 0.5px --color-edge
    <ChatView/>           flex-1 · bg-app
    [panel phải]          phase 3+
  </div>
  [modal]
</div>
```

**Sidebar** (`Sidebar.tsx`, `SidebarFooter*.tsx`):

- [ ] Hàng trên: chỗ trống cho nút cửa sổ (72px), nút `+` tạo bot.
- [ ] Ô Search (nền `raised`, bo 8, icon kính lúp).
- [ ] Hàng bot: mascot 48px, tên (đậm), dòng xem trước 1 dòng cắt `…`, giờ bên phải, chấm chưa đọc; hàng đang chọn nền `raised`, bo 12.
- [ ] Chân sidebar: `Automations`, `Plugins`, hàng người dùng (avatar chữ cái + tên + bánh răng).
- [ ] Kéo đổi rộng (`SidebarResizeHandle`), thu thành dải icon 80px khi panel phải mở và cửa sổ hẹp.
- [ ] Dưới 768px: sidebar thành ngăn kéo, nút mở ở góc trái trên, nền mờ `bg-black/50`.

**ChatView** (khung, chưa có logic lượt):

- [ ] Header: mascot nhỏ + tên bot; bên phải `+ Task`, nút model (viên thuốc), icon gọi, icon máy tính.
- [ ] Vùng cuộn: `.chat-column` tối đa `60rem`, căn giữa, khoảng cách hàng `gap-3`.
- [ ] Bong bóng: bot bên trái nền `card`, người dùng bên phải nền `bubble-user`, bo 18, chữ 15px `line-height 1.75`, tối đa `35rem`/80%.
- [ ] Dấu ngày giữa cột ("Wed 12 Aug 2:21").
- [ ] Composer neo đáy: viên thuốc nền `composer`, bo 22 (18 khi nhiều dòng), `+` trái, mic phải, placeholder "Message {tên bot}", tự giãn chiều cao, Enter gửi, Shift+Enter xuống dòng.
- [ ] Trạng thái rỗng (`ChatEmptyState`) và màn "đang tải / chưa có server".

## 4. Backend tối thiểu

- [ ] `wire.py`: `WireBot`, `WireMessage`, `ModelSelection`, `ServerFrame` (bắt đầu với các kind `bot`, `bot.deleted`, `bots.order`, `message`, `message.patch`, `runtime`, `config`, `sections`).
- [ ] `events.py`: `RuntimeEvent` đầy đủ theo `shared/runtime-events.ts` (dùng ngay ở phase 2).
- [ ] `bus.py`: pub/sub trong tiến trình; `GET /api/events` trả SSE, gửi snapshot khi nối, heartbeat 15 giây, hỗ trợ nối lại.
- [ ] `store/`: SQLite `bots`, `threads`, `messages` (có `parent_id` cho nhánh), `config.json`.
- [ ] Route:

  | Phương thức | Đường dẫn | Việc |
  |---|---|---|
  | GET | `/api/events` | Luồng SSE duy nhất |
  | GET | `/api/config` | Trạng thái cấu hình (cờ, không có bí mật) |
  | GET / POST | `/api/bots` | Danh sách / tạo bot |
  | PATCH / DELETE | `/api/bots/{id}` | Sửa / xoá |
  | PUT | `/api/bots/order` | Sắp xếp |
  | GET | `/api/bots/{id}/messages?before=` | Phân trang (200 mỗi trang như gốc) |
  | POST | `/api/bots/{id}/messages` | Gửi tin |
  | POST | `/api/bots/{id}/read` | Đánh dấu đã đọc |
  | GET | `/api/instances` | Danh sách engine (phase 1: chỉ driver giả) |

- [ ] `drivers/base.py`: SPI `ProviderAdapter` (`send_turn`, `interrupt_turn`, `respond_to_request`, `steer`, `on_event`, `capabilities`).
- [ ] `drivers/echo.py`: driver giả phát `turn.started` → nhiều `content.delta` → `item.completed` → `turn.completed`.

Đường dẫn và hình dạng body đối chiếu lại với `server/routes/*.ts` của bản gốc khi cài từng route.

## 5. Store phía client

- [ ] `state/store.tsx`: `AppState` + `reducer` theo bản gốc, giới hạn ở `bots`, `selectedId`, `instances`, `config`, `connected`, `hydrated`, các cờ mở panel.
- [ ] `state/sse.ts`: một `EventSource`, ánh xạ `ServerFrame` → `Action`, tự nối lại, đặt `connected`.
- [ ] `state/api.ts`: hàm `api()` với `ApiError`, timeout.
- [ ] Gửi lạc quan: tin người dùng hiện ngay, đối chiếu bằng `sendId` khi frame `message` về.

## 6. Kiểm thử

- [ ] pytest: CRUD bot, phân trang tin, SSE phát đúng thứ tự frame, snapshot khi nối lại.
- [ ] Vitest: reducer với chuỗi frame mẫu.
- [ ] Playwright so ảnh với bản gốc: màn chính có 4 bot (so với `hero.png`), trạng thái rỗng, sidebar thu icon, bản di động có ngăn kéo.

## Tiêu chí hoàn thành

1. `pnpm dev` mở `http://127.0.0.1:5299`, thấy khung giống bản gốc; so ảnh 4 màn trên đạt ngưỡng ≤ 0,5%.
2. Tạo bot → hiện ở sidebar ngay qua SSE (không tải lại trang); mở tab thứ hai cũng thấy.
3. Gửi tin → driver giả trả lời theo dòng chảy từng đoạn.
4. Tắt backend → hiện dải "mất kết nối"; bật lại → tự nối, trạng thái đúng.
5. `typecheck` và toàn bộ test xanh trên Windows.

## Cập nhật sau đối chiếu (2026-11-10)

- **Đã làm:** khung theo **Simple** (xem README §7.1): nút tròn Search/New, Inbox, hàng bot 54px, ChatHeadPill, viên thuốc model, composer dock, bong bóng 15/22px, kéo đổi rộng + thu icon, skin theo hệ điều hành, mascot lấy path gốc.
- **Sửa lại các mục ở trên:** mục "Sidebar" và "ChatView" mô tả bản README (Advanced) — chỉ là tham khảo; bản chuẩn là Simple. Ảnh đối chiếu: chụp từ app đang chạy, không dùng `hero.png`.
- **Còn thiếu:** tile Chief MausBot + huy hiệu, huy hiệu engine trên hàng bot, khuôn mặt mascot theo bộ biểu cảm gốc, so ảnh pixel Playwright, kiểm tra bản di động (ngăn kéo).
