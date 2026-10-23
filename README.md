# 🚀 Muse Session Hub & Web Launcher (Next.js 16 Edition)

Công cụ web hiện đại xây dựng trên **Next.js phiên bản mới nhất (Next.js 16 App Router + React 19)** giúp bạn quản lý, kiểm tra và tự động nạp **Session Cookies của Muse Web** (`hatch_sess`, `hatch_vml`, `datr`, `hatch_gw`, v.v.) để đăng nhập vào [muse.ai](https://muse.ai) chỉ với **1 cú click**, không cần thực hiện thủ công trong DevTools.

---

## ✨ Tính Năng Nổi Bật

1. **Next.js 16 App Router & Turbopack**:
   - Được tái cấu trúc hoàn toàn trên nền tảng **Next.js 16** với kiến trúc App Router, React 19 Client & Server Components, và Turbopack cho tốc độ phản hồi cực nhanh.
   - Giao diện Dark Glassmorphism cao cấp, hiệu ứng ánh sáng động (ambient glow), mượt mà trên mọi thiết bị.

2. **Khởi Chạy Trình Duyệt 1-Click (Auto-Inject)**:
   - Tự động phát hiện Google Chrome hoặc Microsoft Edge trên máy tính.
   - Khi bấm **"Mở Muse Web Ngay"**, hệ thống nạp toàn bộ 12 cookies vào domain `.muse.ai` và mở thẳng `https://muse.ai/` ở trạng thái đã đăng nhập.

3. **Kiểm Tra Trạng Thái Session Trực Tiếp (Live Health & VM Test)**:
   - Kết nối trực tiếp đến API `/api/session` của Muse.
   - Hiển thị trạng thái máy ảo (**RUNNING** / **Assigned**), VM ID và kết nối WebSocket (`metaaivm.com`).

4. **Quản Lý Nhiều Tài Khoản (Multi-Account Switcher)**:
   - Lưu trữ, đặt tên và chuyển đổi giữa các tài khoản Muse khác nhau mà không lo mất phiên đăng nhập.

5. **Kèm Tiện Ích Bookmarklet 1-Click**:
   - Kéo nút Bookmarklet vào thanh dấu trang trình duyệt để inject cookie trực tiếp vào tab `muse.ai` đang mở.

6. **Kèm Extension Chrome/Edge Đóng Gói Sẵn**:
   - Thư mục `./extension` chuẩn Manifest V3 sẵn sàng cài đặt.

7. **Cổng Kết Nối API Desktop (OpenAI-Compatible Gateway)**:
   - Cung cấp trọn bộ endpoint chuẩn OpenAI: `/v1/chat/completions`, `/v1/models`.
   - Hỗ trợ cả phản hồi tuần tự JSON và phản hồi phát trực tiếp SSE Streaming (`stream: true`).
   - Tương thích 100% với các ứng dụng desktop AI hàng đầu: **Cherry Studio**, **Chatbox**, **NextChat**, **LobeChat**, **Cursor IDE**, **Continue**, cũng như các thư viện **OpenAI Python / Node SDK**.

---

## 🔌 Hướng Dẫn Kết Nối API Vào Các Phần Mềm Desktop

Hệ thống Next.js tích hợp sẵn máy chủ Gateway chuẩn OpenAI. Bạn chỉ cần cấu hình vào phần mềm desktop như sau:

| Thông số | Giá trị |
| :--- | :--- |
| **API Base URL** | `http://localhost:3000/v1` *(hoặc `http://localhost:3000/api/v1`)* |
| **API Key** | `sk-muse-session` *(hoặc bất kỳ ký tự nào)* |
| **Model ID** | `muse-chat` *(hoặc alias `gpt-4o`, `claude-3-5-sonnet`, `deepseek-chat`)* |

### 1. Kết nối với Cherry Studio
1. Vào **Cài đặt** (Settings) &rarr; **Nhà cung cấp mô hình** (Model Providers).
2. Chọn nhà cung cấp **OpenAI** (hoặc tạo Custom Provider).
3. Điền **API Base URL**: `http://localhost:3000/v1`
4. Điền **API Key**: `sk-muse-session`
5. Thêm mã mô hình: `muse-chat`
6. Bấm kiểm tra kết nối & bắt đầu trò chuyện.

### 2. Kết nối với Chatbox AI
1. Mở Chatbox &rarr; **Cài đặt** (Settings).
2. Tại mục **AI Model Provider**, chọn **OpenAI API**.
3. **API Host**: Nhập `http://localhost:3000` *(Chatbox sẽ tự động thêm `/v1/chat/completions`)*.
4. **API Key**: `sk-muse-session`.
5. **Model**: Chọn tùy chỉnh và nhập `muse-chat`.

### 3. Gọi trực tiếp bằng cURL
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-muse-session" \
  -d '{
    "model": "muse-chat",
    "messages": [{"role": "user", "content": "Xin chào Muse!"}],
    "stream": false
  }'
```

### 4. Gọi bằng Python (OpenAI SDK)
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-muse-session"
)

response = client.chat.completions.create(
    model="muse-chat",
    messages=[{"role": "user", "content": "Xin chào Muse AI!"}],
    stream=True
)

for chunk in response:
    content = chunk.choices[0].delta.content or ""
    print(content, end="", flush=True)
```

---

## 🛠️ Hướng Dẫn Cài Đặt & Khởi Động

### Chạy ở chế độ phát triển (Development):
```bash
npm run dev
```

### Build & Chạy bản Production:
```bash
npm run build
npm start
```

### Chạy server độc lập (Node.js Server):
```bash
npm run server
```

👉 Mở trình duyệt và truy cập: **[http://localhost:3000](http://localhost:3000)**

---

## 🎯 3 Cách Sử Dụng Tiện Lợi

### Cách 1: Sử dụng trực tiếp từ Web Dashboard Next.js (Khuyên dùng)
1. Mở `http://localhost:3000`.
2. Dán chuỗi cookie của bạn vào ô văn bản (tool đã tự động nạp sẵn tài khoản của bạn).
3. Bấm **"⚡ Kiểm Tra Trạng Thái VM"** để kiểm tra session.
4. Bấm **"🚀 Mở Muse Web Ngay"** &mdash; Chrome/Edge sẽ tự động mở lên với tài khoản đã đăng nhập!

### Cách 2: Sử dụng Bookmarklet 1-Click trên trình duyệt
1. Trên giao diện web, chọn tab **"Bookmarklet 1-Click"**.
2. Kéo nút màu tím **"⚡ Đăng Nhập Muse"** vào thanh Bookmark (`Ctrl+Shift+B`).
3. Mở tab `https://muse.ai/` và bấm vào Bookmark để inject.

### Cách 3: Cài đặt Extension đóng gói sẵn
1. Mở Chrome/Edge, truy cập `chrome://extensions`.
2. Bật **"Developer mode"**.
3. Bấm **"Load unpacked"** và chọn thư mục `extension`: `d:\Workspace\04_Tools-Agents\muse\extension`.
4. Bấm vào biểu tượng tiện ích trên thanh công cụ để sử dụng bất kỳ lúc nào.

---

## 📁 Cấu Trúc Dự Án (Next.js 16)

```
muse/
├── src/
│   ├── app/
│   │   ├── layout.js          # Next.js 16 Root Layout & Fonts
│   │   ├── page.js            # Interactive Client Component Dashboard
│   │   ├── globals.css        # Vanilla CSS Design System & Glassmorphism
│   │   └── api/
│   │       ├── browsers/      # API kiểm tra trình duyệt Chrome/Edge
│   │       ├── parse/         # API bóc tách token cookie
│   │       ├── test-session/  # API live ping tới muse.ai/api/session
│   │       ├── launch-browser/# API Puppeteer CDP khởi chạy trình duyệt
│   │       ├── sessions/      # API CRUD quản lý hồ sơ cookie
│   │       └── bookmarklet/   # API sinh mã bookmarklet
│   └── lib/
│       └── museService.js     # Shared backend service logic
├── next.config.mjs            # Cấu hình Next.js 16 & External Packages
├── jsconfig.json              # Path aliases (@/* -> ./src/*)
├── package.json               # Dependencies (Next.js 16, React 19, Puppeteer)
├── data/
│   └── sessions.json          # Lưu trữ hồ sơ tài khoản
├── extension/                 # Chrome/Edge Extension Manifest V3
└── README.md
```
