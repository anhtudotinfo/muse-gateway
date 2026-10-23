'use client';

import React from 'react';
import { ROLES_MAP } from '@/constants/cookieRoles';

interface TokenInspectorTabProps {
  parsedEntries: [string, string][];
}

export function TokenInspectorTab({ parsedEntries }: TokenInspectorTabProps) {
  return (
    <div className="tab-surface">
      <div className="apple-guide-box">
        <h3 className="guide-heading">Phân Tích Thông Số Token</h3>
        <p className="caption-text" style={{ marginBottom: 12 }}>
          Chi tiết các tham số bảo mật của hệ thống Meta Muse.
        </p>

        <div className="apple-table-shell">
          <table className="apple-table">
            <thead>
              <tr>
                <th>Tên Cookie</th>
                <th>Ý Nghĩa & Chức Năng</th>
                <th>Giá Trị</th>
              </tr>
            </thead>
            <tbody>
              {parsedEntries.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '24px' }}>
                    Chưa có cookie nào được nhập.
                  </td>
                </tr>
              ) : (
                parsedEntries.map(([key, val]) => (
                  <tr key={key}>
                    <td>
                      <span className="table-token-name">{key}</span>
                    </td>
                    <td>
                      <span className="table-token-role">
                        {ROLES_MAP[key] || 'Cookie bổ trợ của phiên'}
                      </span>
                    </td>
                    <td>
                      <span className="table-token-val" title={val}>
                        {val.length > 36 ? val.slice(0, 33) + '...' : val}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
