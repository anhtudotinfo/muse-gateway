'use client';

import React from 'react';
import type { Profile } from '@/types';

interface ProfilesTabProps {
  profiles: Profile[];
  onRefresh: () => void;
  onUseProfile: (profile: Profile) => void;
  onDeleteProfile: (id: string, name: string) => void;
}

export function ProfilesTab({
  profiles,
  onRefresh,
  onUseProfile,
  onDeleteProfile,
}: ProfilesTabProps) {
  return (
    <div className="tab-surface">
      <div className="tab-top-caption">
        <span className="caption-text">Chuyển đổi giữa các tài khoản đã lưu nhanh chóng.</span>
        <button type="button" className="apple-tool-btn" onClick={onRefresh}>
          Làm mới
        </button>
      </div>

      <div className="apple-profiles-stack">
        {profiles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-tertiary)' }}>
            Chưa có hồ sơ cookie nào được lưu.
          </div>
        ) : (
          profiles.map((p) => (
            <div key={p.id} className="apple-list-item">
              <div className="item-left-block">
                <h4>
                  {p.name}
                  <span className="tag-badge">Muse</span>
                </h4>
                <div className="item-timestamp">
                  {new Date(p.updatedAt).toLocaleString('vi-VN')}
                </div>
              </div>
              <div className="item-right-actions">
                <button type="button" className="btn-item-use" onClick={() => onUseProfile(p)}>
                  Sử Dụng
                </button>
                <button
                  type="button"
                  className="btn-item-del"
                  onClick={() => onDeleteProfile(p.id, p.name)}
                  title="Xóa"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
