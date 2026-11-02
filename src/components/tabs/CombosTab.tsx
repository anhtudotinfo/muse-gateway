'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '@/components/AppShell';
import { HeaderSlot } from '@/components/HeaderSlot';
import { maskName } from '@/lib/mask';
import type { PoolCombo, PoolStateView, PoolStrategy } from '@/lib/musePool';

const STRATEGIES: { key: PoolStrategy; short: string; label: string; desc: string }[] = [
  { key: 'round-robin', short: 'Xoay đều', label: 'Xoay đều', desc: 'Lần lượt từng tài khoản, chia tải đều nhau.' },
  { key: 'fallback', short: 'Dự phòng', label: 'Dự phòng theo thứ tự', desc: 'Thử theo thứ tự, lỗi mới chuyển tài khoản sau.' },
  { key: 'fusion', short: 'Song song', label: 'Chạy song song', desc: 'Gửi cùng lúc tới mọi tài khoản, lấy kết quả về trước. Tốn lượt.' },
];

const strategyLabel = (s: PoolStrategy) => STRATEGIES.find((x) => x.key === s)?.label || s;

export function CombosTab({ onCopyText }: { onCopyText: (t: string, l: string) => void }) {
  const { maskEmails, showToast } = useApp();
  // null until the first fetch lands, so the empty state never flashes.
  const [combos, setCombos] = useState<PoolCombo[] | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<PoolCombo | null>(null);
  const [formName, setFormName] = useState('');
  const [formStrategy, setFormStrategy] = useState<PoolStrategy>('round-robin');
  const [formAccounts, setFormAccounts] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const formRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([fetch('/api/combos'), fetch('/api/pool')]);
      setCombos((await c.json()).combos || []);
      const pool: PoolStateView = await p.json();
      setAccounts((pool.accounts || []).map((a) => ({ id: a.id, name: a.name })));
    } catch {
      setCombos((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Bring the inline form into view and focus the name field when it opens.
  useEffect(() => {
    if (!showForm) return;
    formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    nameRef.current?.focus();
  }, [showForm, editing]);

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
    try {
      const res = await fetch('/api/combos', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editing
            ? { id: editing.id, name: formName, strategy: formStrategy, accountIds: formAccounts }
            : { name: formName, strategy: formStrategy, accountIds: formAccounts }
        ),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(j.error || `Lỗi ${res.status}`, 'error');
        return;
      }
      setShowForm(false);
      showToast(editing ? 'Đã lưu combo' : `Đã tạo combo "${formName.trim()}"`, 'success');
      refresh();
    } catch (e: any) {
      showToast('Lỗi lưu combo: ' + (e?.message || e), 'error');
    }
  };

  const remove = async (combo: PoolCombo) => {
    if (
      !confirm(
        `Xóa combo "${combo.name}"?\n\nCombo chỉ là group routing — các tài khoản trong combo vẫn được giữ nguyên.`
      )
    )
      return;
    try {
      const res = await fetch(`/api/combos?id=${encodeURIComponent(combo.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast(j.error || `Lỗi xóa combo (${res.status})`, 'error');
        return;
      }
      if (editing?.id === combo.id) setShowForm(false);
      showToast(`Đã xóa combo "${combo.name}"`, 'info');
      refresh();
    } catch (e: any) {
      showToast('Lỗi xóa combo: ' + (e?.message || e), 'error');
    }
  };

  const accountName = (id: string) => maskName(accounts.find((a) => a.id === id)?.name || id, maskEmails);
  const example = combos?.[0]?.name || 'video-fast';

  return (
    <div className="pool-page">
      <HeaderSlot>
        <button type="button" className="acc2-btn primary" onClick={startCreate}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Tạo combo
        </button>
      </HeaderSlot>

      <section aria-label="Combo là gì" className="ov2-card pool-explainer">
        <div className="pool-explainer-text">
          Combo là một <b>model ảo</b>: gọi <code>model = &quot;tên combo&quot;</code> thì request chỉ chạy trên các
          tài khoản trong combo, theo cách chia riêng của combo.
        </div>
        <code className="pool-code">{`{ "model": "${example}", "messages": [ … ] }`}</code>
      </section>

      <section aria-label="Danh sách combo" className="acc2-card">
        {combos === null ? (
          <div className="pool-loading" aria-busy="true">
            <div className="skeleton pool-skel" />
            <div className="skeleton pool-skel" />
            <span className="acc2-muted">Đang tải…</span>
          </div>
        ) : combos.length === 0 ? (
          <div className="acc2-empty">
            <div className="acc2-empty-title">Chưa có combo</div>
            <p>Tạo combo đầu tiên để gom tài khoản theo model.</p>
            {!showForm && (
              <button type="button" className="acc2-btn primary" onClick={startCreate}>
                Tạo combo
              </button>
            )}
          </div>
        ) : (
          <div className="acc2-scroll">
            <table className="acc2-table pool-table">
              <thead>
                <tr>
                  <th>Tên combo (model)</th>
                  <th>Cách chia</th>
                  <th>Tài khoản</th>
                  <th><span className="pool-sr">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {combos.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="pool-combo-name">
                        <code>{c.name}</code>
                        <button
                          type="button"
                          className="acc2-icon-btn pool-copy"
                          aria-label={`Sao chép tên combo ${c.name}`}
                          title="Sao chép tên để dùng làm model"
                          onClick={() => onCopyText(c.name, 'Tên combo')}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                            <rect x="9" y="9" width="12" height="12" rx="2" />
                            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td>
                      <span className="acc2-pill">{strategyLabel(c.strategy)}</span>
                    </td>
                    <td className="pool-wrap">
                      <div className="pool-tags">
                        {c.accountIds.length ? (
                          c.accountIds.map((id) => (
                            <span key={id} className="pool-tag">{accountName(id)}</span>
                          ))
                        ) : (
                          <span className="acc2-muted">Mọi tài khoản</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="acc2-actions">
                        <button type="button" className="acc2-btn small" onClick={() => startEdit(c)}>Sửa</button>
                        <button type="button" className="acc2-btn small pool-danger" onClick={() => remove(c)}>Xoá</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showForm && (
        <section
          ref={formRef}
          aria-label={editing ? 'Sửa combo' : 'Tạo combo'}
          className="ov2-card pool-card pool-form"
        >
          <h2 className="pool-h2">{editing ? `Sửa combo ${editing.name}` : 'Tạo combo'}</h2>
          <form
            className="pool-form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            id="pool-combo-form"
          >
            <div className="pool-field">
              <label htmlFor="pool-combo-name" className="pool-label">Tên combo</label>
              <input
                id="pool-combo-name"
                ref={nameRef}
                className="pool-input"
                placeholder="vd: video-fast"
                autoComplete="off"
                spellCheck={false}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
              <span className="pool-help">Chữ thường, số, dấu gạch. Đây là giá trị model khi gọi API.</span>
            </div>
            <div className="pool-field">
              <span className="pool-label" id="pool-combo-strategy">Cách chia</span>
              <div className="acc2-segment small pool-segment" role="group" aria-labelledby="pool-combo-strategy">
                {STRATEGIES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={formStrategy === s.key}
                    className={formStrategy === s.key ? 'active' : ''}
                    title={s.desc}
                    onClick={() => setFormStrategy(s.key)}
                  >
                    {s.short}
                  </button>
                ))}
              </div>
              <span className="pool-help">{STRATEGIES.find((s) => s.key === formStrategy)?.desc}</span>

              <span className="pool-label pool-label-gap">Tài khoản trong combo</span>
              <div className="pool-checks">
                {accounts.map((a) => (
                  <label key={a.id} className="acc2-check pool-check">
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
                  <span className="acc2-muted">Chưa có tài khoản — thêm ở tab Tài khoản.</span>
                )}
              </div>
              <span className="pool-help">Bỏ chọn hết = dùng mọi tài khoản.</span>
            </div>
          </form>
          <div className="pool-form-actions">
            <button type="button" className="acc2-btn" onClick={() => setShowForm(false)}>Huỷ</button>
            <button type="submit" form="pool-combo-form" className="acc2-btn primary" disabled={!formName.trim()}>
              Lưu combo
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
