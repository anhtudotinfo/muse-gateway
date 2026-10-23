# 🚀 Muse Session Hub & Web Launcher

Công cụ web chuyên nghiệp giúp bạn quản lý, kiểm tra và tự động nạp **Session Cookies của Muse Web** (`hatch_sess`, `hatch_vml`, `datr`, `hatch_gw`, v.v.) để đăng nhập vào [muse.ai](https://muse.ai) chỉ với **1 cú click**, không cần thực hiện thủ công trong DevTools.

---

## ✨ Tính Năng Nổi Bật

1. **Khởi Chạy Trình Duyệt 1-Click (Auto-Inject)**:
   - Tự động mở Google Chrome hoặc Microsoft Edge với profile độc lập.
   - Nạp toàn bộ cookie trực tiếp vào domain `.muse.ai`.
   - Mở sẵn `https://muse.ai/` ở trạng thái đã đăng nhập hoàn chỉnh.

2. **Kiểm Tra Trạng Thái Session Trực Tiếp (Live Health & VM Test)**:
   - Kết nối trực tiếp đến API `/api/session` của Muse.
   - Hiển thị trạng thái máy ảo (**RUNNING** / **Assigned**), VM ID và kết nối WebSocket (`metaaivm.com`).

3. **Quản Lý Nhiều Tài Khoản (Multi-Account Switcher)**:
   - Lưu trữ, đặt tên và ghi chú cho từng session (ví dụ: *Acc chính*, *Acc phụ*).
   - Chuyển đổi tài khoản nhanh chóng chỉ bằng 1 nút bấm.

4. **Kèm Tiện Ích Bookmarklet 1-Click**:
   - Chỉ cần kéo nút Bookmarklet vào thanh dấu trang trình duyệt.
   - Nhấn bookmark khi đang ở tab `muse.ai` để nạp ngay cookie mà không cần mở lại trình duyệt.

5. **Kèm Tiện Ích Chrome/Edge Extension Đóng Gói Sẵn**:
   - Thư mục `./extension` chuẩn Manifest V3.
   - Dán cookie vào popup extension bất cứ lúc nào.

---

## 🛠️ Hướng Dẫn Cài Đặt & Khởi Động

### Bước 1: Khởi động Web Tool
Mở terminal trong thư mục dự án và chạy:
```bash
npm start
```
Hoặc:
```bash
node server.js
```

### Bước 2: Truy cập Giao Diện
Mở trình duyệt và truy cập:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🎯 3 Cách Sử Dụng Tiện Lợi

### Cách 1: Sử dụng trực tiếp từ Web Dashboard (Khuyên dùng)
1. Mở `http://localhost:3000`.
2. Dán chuỗi cookie của bạn vào ô văn bản (tool đã tự động nạp sẵn tài khoản của bạn).
3. Bấm **"⚡ Kiểm Tra Trạng Thái VM"** để đảm bảo session còn sống.
4. Bấm **"🚀 Mở Muse Web Ngay"** &mdash; Chrome/Edge sẽ tự động mở lên và bạn đã ở trong tài khoản Muse!

### Cách 2: Sử dụng Bookmarklet trên trình duyệt có sẵn
1. Trên giao diện web, chuyển sang tab **"Bookmarklet 1-Click"**.
2. Kéo nút màu tím **"⚡ Đăng Nhập Muse"** vào thanh Bookmark (`Ctrl+Shift+B` để hiện thanh).
3. Mở tab `https://muse.ai/` rồi bấm vào Bookmark đó. Toàn bộ cookie sẽ được inject và trang tự reload.

### Cách 3: Cài đặt Chrome Extension đóng gói sẵn
1. Mở Chrome/Edge, truy cập `chrome://extensions`.
2. Bật **"Developer mode"** (Chế độ dành cho nhà phát triển).
3. Bấm **"Load unpacked"** (Tải tiện ích đã giải nén).
4. Chọn thư mục `extension` trong dự án: `d:\Workspace\04_Tools-Agents\muse\extension`.
5. Bấm vào biểu tượng tiện ích trên thanh công cụ để sử dụng bất kỳ lúc nào!

---

## 🔑 Giải Mã Các Cookie Của Muse / Meta Hatch

| Tên Cookie | Vai Trò & Chức Năng |
| :--- | :--- |
| **`hatch_sess`** | Token định danh phiên làm việc của người dùng (Session Core) |
| **`hatch_vml`** | Giấy phép truy cập Virtual Machine (VM Lease Token) |
| **`hatch_gw`** | Gateway Token dùng để định tuyến WebSocket tới VM |
| **`hatch_native_auth_device`** | Fingerprint kiểm soát thiết bị phần cứng của Meta |
| **`hatch_native_auth_temp`** | Token ủy quyền tạm thời của Meta AI / Hatch Engine |
| **`datr`** | Token nhận diện trình duyệt đáng tin cậy của Meta |
| **`__Host-hatch_one_tap`** | Token xác thực One-Tap bảo mật cao chống giả mạo |
| **`theme`** | Cấu hình theme giao diện chat của người dùng |

---

## 📁 Cấu Trúc Dự Án

```
muse/
├── server.js          # Express backend & Puppeteer CDP browser launcher
├── package.json       # Cấu hình dự án & dependencies
├── data/
│   └── sessions.json  # Cơ sở dữ liệu lưu các session tài khoản
├── public/
│   ├── index.html     # Giao diện chính Dark Glassmorphism
│   ├── index.css      # Hệ thống CSS hiện đại, phong cách cao cấp
│   └── app.js         # Xử lý logic phía client, phân tích token
├── extension/         # Chrome/Edge Extension Manifest V3
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── README.md
```
