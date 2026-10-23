'use client';

import React from 'react';

interface SaveProfileModalProps {
  isOpen: boolean;
  profileName: string;
  onNameChange: (name: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export function SaveProfileModal({
  isOpen,
  profileName,
  onNameChange,
  onClose,
  onSave,
}: SaveProfileModalProps) {
  if (!isOpen) return null;

  return (
    <div className="apple-modal-overlay" onClick={onClose}>
      <div className="apple-sheet-window" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h3>Lưu Hồ Sơ Session</h3>
          <button type="button" className="btn-sheet-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div>
          <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            Tên tài khoản hoặc ghi chú:
          </label>
          <input
            type="text"
            className="apple-input-field"
            value={profileName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Ví dụ: Muse Pro Account..."
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave();
            }}
          />
          <p style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
            Hồ sơ sẽ được lưu an toàn trên máy tính của bạn.
          </p>
        </div>
        <div className="sheet-footer">
          <button type="button" className="apple-tool-btn" onClick={onClose}>
            Hủy
          </button>
          <button
            type="button"
            className="btn-apple-primary"
            style={{ padding: '8px 18px', flex: 'none', borderRadius: 'var(--radius-pill)' }}
            onClick={onSave}
          >
            Lưu
          </button>
        </div>
      </div>
    </div>
  );
}
