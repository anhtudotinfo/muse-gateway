'use client';

import React from 'react';

interface ExtensionTabProps {
  onCopyExtensionPath: () => void;
}

export function ExtensionTab({ onCopyExtensionPath }: ExtensionTabProps) {
  return (
    <div className="tab-surface">
      <div className="apple-guide-box">
        <span className="guide-pill-indicator">Chrome Extension</span>
        <h3 className="guide-heading">Cài Đặt Tiện Ích Mở Rộng Sẵn Có</h3>
        <p className="caption-text" style={{ marginBottom: 16 }}>
          Dự án đã đóng gói sẵn extension chuẩn Manifest V3 tại thư mục <code>./extension</code>.
        </p>

        <ol className="apple-step-list">
          <li>
            Mở trình duyệt Chrome/Edge, vào: <code>chrome://extensions</code>
          </li>
          <li>
            Gạt bật <strong>&quot;Developer mode&quot; (Chế độ cho nhà phát triển)</strong> ở góc trên bên phải.
          </li>
          <li>
            Bấm nút <strong>&quot;Load unpacked&quot; (Tải tiện ích đã giải nén)</strong>.
          </li>
          <li>
            Chọn thư mục: <code>d:\Workspace\04_Tools-Agents\muse\extension</code>
          </li>
          <li>Xong! Bạn có thể dán cookie và mở Muse trực tiếp trên thanh công cụ.</li>
        </ol>

        <div className="apple-banner-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="banner-icon">🧩</div>
            <div className="banner-copy">
              <h4>Muse Cookie Switcher Extension</h4>
              <p>Tương thích Chrome, Edge, Brave, Cốc Cốc.</p>
            </div>
          </div>
          <button type="button" className="apple-tool-btn" onClick={onCopyExtensionPath}>
            Copy Đường Dẫn
          </button>
        </div>
      </div>
    </div>
  );
}
