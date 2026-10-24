'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from '@/components/AppShell';
import { maskName } from '@/lib/mask';
import type { PoolCombo, PoolStateView, PoolStrategy } from '@/lib/musePool';

const STRATEGIES: { key: PoolStrategy; label: string }[] = [
  { key: 'fallback', label: 'Fallback — thử theo thứ tự' },
  { key: 'round-robin', label: 'Round Robin — xoay đều' },
  { key: 'fusion', label: 'Fusion — chạy song song, lấy reply nhanh nhất' },
];

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid var(--apple-border-light)',
  background: 'var(--apple-surface)',
  fontSize: 13,
  fontFamily: 'inherit',
  color: 'var(--text-primary)',
};

export function CombosTab({ onCopyText }: { onCopyText: (t: string, l: string) => void }) {
  const { maskEmails } = useApp();
  const [combos, setCombos] = useState<PoolCombo[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<PoolCombo | null>(null);
  const [formName, setFormName] = useState('');
  const [formStrategy, setFormStrategy] = useState<PoolStrategy>('round-robin');
  const [formAccounts, setFormAccounts] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([fetch('/api/combos'), fetch('/api/pool')]);
      setCombos((await c.json()).combos || []);
      const pool: PoolStateView = await p.json();
      setAccounts((pool.accounts || []).map((a) => ({ id: a.id, name: a.name })));
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startCreate = () => {
    setEditing(null);
    setFormName('');
    setFormStrategy('round-robin');
    setFormAccounts(accounts.map((a) => a.id));
    setShowForm(true);
  };

  const startEdit = (c: PoolCombo) => {
    setEditing(c);
    setFormName(c.name);
    setFormStrategy(c.strategy);
    setFormAccounts([...c.accountIds]);
    setShowForm(true);
  };

  const save = async () => {
    if (!formName.trim()) return;
    if (editing) {
      await fetch('/api/combos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, name: formName, strategy: formStrategy, accountIds: formAccounts }),
      });
    } else {
      await fetch('/api/combos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName, strategy: formStrategy, accountIds: formAccounts }),
      });
    }
    setShowForm(false);
    refresh();
  };

  const remove = async (id: string) => {
    await fetch(`/api/combos?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    refresh();
  };

  const accountName = (id: string) => maskName(accounts.find((a) => a.id === id)?.name || id, maskEmails);

  return (
    <div className="tab-surface">
      <div className="tab-top-caption">
        <span className="caption-text">
          Gom account thành combo, chọn strategy — đặt <code>model = tên combo</code> trong request để route qua combo.
        </span>
        <button type="button" className="btn-apple-secondary" onClick={startCreate}>
          + Create Combo
        </button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.7, marginBottom: 14 }}>
        <div><strong style={{ color: 'var(--text-secondary)' }}>Fallback</strong> — thử account theo thứ tự (next khi lỗi)</div>
        <div><strong style={{ color: 'var(--text-secondary)' }}>Round Robin</strong> — xoay đều giữa các account</div>
        <div><strong style={{ color: 'var(--text-secondary)' }}>Fusion</strong> — gọi song song tất cả account, lấy reply nhanh nhất (race)</div>
      </div>

      {showForm && (
        <div className="apple-list-item" style={{ marginBottom: 14, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Tên combo (vd: lyncut-pro)"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
            <select
              style={inputStyle}
              value={formStrategy}
              onChange={(e) => setFormStrategy(e.target.value as PoolStrategy)}
            >
              {STRATEGIES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {accounts.map((a) => (
              <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={formAccounts.includes(a.id)}
                  onChange={(e) =>
                    setFormAccounts(
                      e.target.checked ? [...formAccounts, a.id] : formAccounts.filter((x) => x !== a.id)
                    )
                  }
                />
                {maskName(a.name, maskEmails)}
              </label>
            ))}
            {accounts.length === 0 && (
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Chưa có account — lưu hồ sơ ở trang Accounts.</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="apple-tool-btn" onClick={() => setShowForm(false)}>Hủy</button>
            <button type="button" className="btn-apple-secondary" onClick={save} disabled={!formName.trim()}>
              {editing ? 'Lưu' : 'Tạo'}
            </button>
          </div>
        </div>
      )}

      <div className="apple-profiles-stack">
        {combos.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
            Chưa có combo — tạo combo đầu tiên để group account theo model.
          </div>
        ) : (
          combos.map((c) => (
            <div key={c.id} className="apple-list-item">
              <div className="item-left-block" style={{ flex: 1, minWidth: 0 }}>
                <h4>
                  {c.name}
                  <span className="tag-badge">{c.strategy}</span>
                </h4>
                <div className="item-timestamp" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {c.accountIds.length ? (
                    c.accountIds.map((id) => (
                      <span key={id} className="tag-badge" style={{ background: 'var(--apple-purple-dim)', color: 'var(--apple-purple)' }}>
                        {accountName(id)}
                      </span>
                    ))
                  ) : (
                    <span>— tất cả account —</span>
                  )}
                </div>
              </div>
              <div className="item-right-actions">
                <button type="button" className="apple-tool-btn" onClick={() => onCopyText(c.name, 'Tên combo')} title="Copy tên để dùng làm model">
                  Copy
                </button>
                <button type="button" className="apple-tool-btn" onClick={() => startEdit(c)}>Edit</button>
                <button type="button" className="btn-item-del" onClick={() => remove(c.id)}>Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
