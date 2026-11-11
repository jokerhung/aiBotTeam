"use client";
import { useCallback } from "react";
import { useStore } from "@/state/store";

/** Interface languages. English is the source text; a missing entry simply shows the English. */
export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "vi", label: "Tiếng Việt" },
] as const;

const vi: Record<string, string> = {
  // approvals and questions
  "Allow once": "Cho phép lần này", Deny: "Từ chối", "Always allow": "Luôn cho phép",
  "wants to run a command": "muốn chạy một lệnh", "wants to edit files": "muốn sửa tệp",
  "Answer the approval above to continue": "Hãy trả lời yêu cầu duyệt phía trên để tiếp tục",
  "Type your own answer": "Nhập câu trả lời của bạn", "Pick whatever's closest, or type your own.": "Chọn mục gần nhất hoặc tự nhập.",
  "Select all that apply": "Chọn tất cả mục phù hợp", Submit: "Gửi", "Dismiss question": "Bỏ qua câu hỏi",
  Allowed: "Đã cho phép", Denied: "Đã từ chối", Answered: "Đã trả lời", Skipped: "Đã bỏ qua",
  "by you": "bởi bạn", automatically: "tự động", "by a saved rule": "theo quy tắc đã lưu",
  // composer
  "Attach file": "Đính kèm tệp", "Attach image": "Đính kèm ảnh", "Choose folder": "Chọn thư mục", Approval: "Duyệt quyền",
  Send: "Gửi", Stop: "Dừng", Add: "Thêm",
  // sidebar and menus
  Pin: "Ghim", Unpin: "Bỏ ghim", "Make Chief of Staff": "Đặt làm Chief of Staff", "Move to new section": "Chuyển sang nhóm mới",
  "Mark as Unread": "Đánh dấu chưa đọc", "Mark as Read": "Đánh dấu đã đọc", "Edit Profile": "Sửa hồ sơ", Duplicate: "Nhân bản",
  "Copy conversation ID": "Sao chép mã cuộc trò chuyện", "Hide from sidebar": "Ẩn khỏi thanh bên", Delete: "Xóa",
  Inbox: "Hộp thư", "+ New section": "+ Nhóm mới", Hidden: "Đã ẩn", Unhide: "Hiện lại", Messages: "Tin nhắn",
  Settings: "Cài đặt", "Keyboard shortcuts": "Phím tắt", "Connect apps": "Kết nối ứng dụng", Undo: "Hoàn tác",
  // settings
  General: "Chung", Connections: "Kết nối", Engines: "Công cụ AI", Appearance: "Giao diện",
  "Display name": "Tên hiển thị", Interface: "Giao diện người dùng", Language: "Ngôn ngữ", Font: "Phông chữ",
  "Chat width": "Độ rộng cuộc trò chuyện", "Reduce motion": "Giảm chuyển động", Keys: "Khoá",
  Save: "Lưu", Clear: "Xoá", Connected: "Đã kết nối", Optional: "Tùy chọn",
  "Shared by all bots. Saving a key reloads providers instantly; keys are stored locally and never shown again.":
    "Dùng chung cho mọi bot. Lưu khoá sẽ nạp lại nhà cung cấp ngay; khoá chỉ lưu trên máy và không hiện lại.",
  // bot panel
  Details: "Chi tiết", Library: "Thư viện", Computer: "Máy tính", Model: "Mô hình", Conversations: "Cuộc trò chuyện",
  "New conversation": "Cuộc trò chuyện mới", "This conversation": "Cuộc trò chuyện này", "Find in conversation": "Tìm trong cuộc trò chuyện",
  "Start fresh": "Bắt đầu lại", Activity: "Hoạt động", Inspector: "Trình kiểm tra", Back: "Quay lại",
  // dialogs
  "New bot": "Bot mới", Create: "Tạo", Cancel: "Hủy", Name: "Tên", Title: "Chức danh", Description: "Mô tả",
};

const dictionaries: Record<string, Record<string, string>> = { vi };

export function translate(lang: string, text: string): string {
  return dictionaries[lang]?.[text] ?? text;
}

/** `t("Allow once")` in the chosen language; the English text is the key, so a gap never breaks the screen. */
export function useT() {
  const { state } = useStore();
  const lang = state.config.settings.language;
  return useCallback((text: string) => translate(lang, text), [lang]);
}
