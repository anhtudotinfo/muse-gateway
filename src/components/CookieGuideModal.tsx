"use client";

import React from "react";
import Modal from "@/components/endpoint/ui/Modal";
import Button from "@/components/endpoint/ui/Button";

const COOKIE_EDITOR_URL =
  "https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm";

const stepRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  marginTop: 8,
};

const stepNum = (accent: string): React.CSSProperties => ({
  flexShrink: 0,
  width: 20,
  height: 20,
  borderRadius: "50%",
  background: accent,
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginTop: 1,
});

const stepText: React.CSSProperties = { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55 };

const methodCard: React.CSSProperties = {
  border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
  borderRadius: 12,
  padding: "12px 14px",
  marginTop: 14,
};

function Steps({ accent, items }: { accent: string; items: React.ReactNode[] }) {
  return (
    <div>
      {items.map((s, i) => (
        <div key={i} style={stepRow}>
          <span style={stepNum(accent)}>{i + 1}</span>
          <div style={stepText}>{s}</div>
        </div>
      ))}
    </div>
  );
}

export function CookieGuideModal({
  isOpen,
  onClose,
  onNeverShow,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Khi truyền vào, footer có thêm nút "không hiện lại" để tắt auto-show. */
  onNeverShow?: () => void;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Cách lấy cookie Muse"
      size="lg"
      footer={
        <>
          {onNeverShow && (
            <Button variant="ghost" onClick={onNeverShow}>
              Đã hiểu — không hiện lại
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            Đóng
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
        Cookie là phiên đăng nhập Muse của bạn. App cần chuỗi cookie dạng{" "}
        <code style={{ fontSize: 12 }}>name=value; name=value</code> — bắt buộc có{" "}
        <code style={{ fontSize: 12 }}>hatch_sess</code>.
      </div>

      {/* Cách 0 — khuyên dùng */}
      <div style={{ ...methodCard, borderColor: "var(--apple-green, #30d158)", background: "rgba(48,209,88,0.06)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>
          Cách dễ nhất — không cần cookie
        </div>
        <div style={{ ...stepText, marginTop: 6 }}>
          Bấm nút <b>🔐 Đăng nhập &amp; lưu</b> ngay trong deck này → trình duyệt mở sẵn{" "}
          <code style={{ fontSize: 12 }}>muse.ai</code> → bạn đăng nhập như bình thường → app tự bắt cookie và lưu
          tài khoản. Không cần copy dán gì.
        </div>
      </div>

      {/* Cách 1 — Cookie-Editor extension */}
      <div style={methodCard}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>
          Cách 1 — Extension Cookie-Editor
        </div>
        <Steps
          accent="var(--color-primary, #6c5ce7)"
          items={[
            <>
              Cài extension{" "}
              <a href={COOKIE_EDITOR_URL} target="_blank" rel="noreferrer" style={{ color: "var(--color-primary, #6c5ce7)", fontWeight: 600 }}>
                Cookie-Editor — Chrome Web Store ↗
              </a>{" "}
              (hoạt động trên Chrome, Edge, Brave…)
            </>,
            <>
              Mở <code style={{ fontSize: 12 }}>muse.ai</code> trên trình duyệt đó và <b>đăng nhập</b> tài khoản Muse của bạn.
            </>,
            <>
              Bấm icon <b>Cookie-Editor</b> trên thanh extension → panel liệt kê cookie hiện ra.
            </>,
            <>
              Bấm nút <b>Export</b> (icon xuất ở góc dưới panel) → chọn định dạng{" "}
              <b>Header String</b> — kết quả là một dòng <code style={{ fontSize: 12 }}>k=v; k=v; …</code> đã vào
              clipboard.
            </>,
            <>
              Quay lại đây, <b>dán vào ô bên dưới</b> (mỗi tài khoản một dòng) → bấm <b>Thêm tài khoản</b>.
            </>,
          ]}
        />
      </div>

      {/* Cách 2 — DevTools */}
      <div style={methodCard}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>
          Cách 2 — Không cài extension (DevTools)
        </div>
        <Steps
          accent="var(--apple-orange, #ff9f0a)"
          items={[
            <>
              Mở <code style={{ fontSize: 12 }}>muse.ai</code>, đăng nhập xong → nhấn <b>F12</b> mở DevTools.
            </>,
            <>
              Sang tab <b>Network</b> → tải lại trang (F5) → bấm vào request đầu tiên tới{" "}
              <code style={{ fontSize: 12 }}>muse.ai</code>.
            </>,
            <>
              Trong phần <b>Request Headers</b> tìm dòng <code style={{ fontSize: 12 }}>cookie:</code> → copy toàn bộ
              giá trị sau nó.
            </>,
            <>Dán vào ô bên dưới → Thêm tài khoản.</>,
          ]}
        />
        <div style={{ ...stepText, marginTop: 10, fontSize: 12, color: "var(--text-quaternary)" }}>
          Lưu ý: <code style={{ fontSize: 11 }}>document.cookie</code> trong Console <b>không</b> đủ —{" "}
          <code style={{ fontSize: 11 }}>hatch_sess</code> là HttpOnly nên JS không đọc được; phải lấy từ extension
          hoặc header request.
        </div>
      </div>
    </Modal>
  );
}
