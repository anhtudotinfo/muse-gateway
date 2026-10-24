'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppShell';
import { maskName } from '@/lib/mask';
import type { LicenseView } from '@/lib/license';

const inputStyle: React.CSSProperties = {
  padding: '8px 11px',
  borderRadius: 8,
  border: '1px solid var(--apple-border-light)',
  background: 'var(--apple-surface)',
  fontSize: 13,
  fontFamily: 'inherit',
  color: 'var(--text-primary)',
  width: '100%',
};

const fieldLabel: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 4,
};

const fieldBox: React.CSSProperties = {
  background: 'var(--apple-surface-hover, rgba(255,255,255,0.04))',
  border: '1px solid var(--apple-border-light, rgba(255,255,255,0.08))',
  borderRadius: 8,
  padding: '9px 12px',
  fontSize: 13,
  fontFamily: 'monospace',
  color: 'var(--text-primary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minWidth: 0,
};

function Field({ label, value, mono = true, onCopy }: { label: string; value: string; mono?: boolean; onCopy?: () => void }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={fieldLabel}>{label}</div>
      <div style={{ ...fieldBox, fontFamily: mono ? 'monospace' : 'inherit' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</span>
        {onCopy && (
          <button type="button" className="apple-tool-btn" style={{ padding: '2px 8px', fontSize: 11, flexShrink: 0 }} onClick={onCopy}>
            Sao chép
          </button>
        )}
      </div>
    </div>
  );
}

export function LicenseTab() {
  const { maskEmails, copyText, showToast } = useApp();
  const [lic, setLic] = useState<LicenseView | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [formKey, setFormKey] = useState('');
  const [saving, setSaving] = useState(false);
  // Key generator (vendor tools — mint keys for this/other machines)
  const [genOpen, setGenOpen] = useState(false);
  const [genEmail, setGenEmail] = useState('');
  const [genDays, setGenDays] = useState('365');
  const [genBind, setGenBind] = useState(true);
  const [genKey, setGenKey] = useState('');
  const [generating, setGenerating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const j = await (await fetch('/api/license')).json();
      setLic(j);
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const verify = async () => {
    setVerifying(true);
    try {
      const j = await (await fetch('/api/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify' }),
      })).json();
      setLic(j);
      showToast(j.ok ? `Verify: ${j.reason}` : `Verify thất bại: ${j.reason}`, j.ok ? 'success' : 'error');
    } catch {
      showToast('Lỗi verify license', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const activate = async () => {
    if (!formKey.trim()) {
      showToast('Dán license key trước', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: formKey }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      setLic(j);
      setFormKey('');
      showToast(`Đã kích hoạt license cho ${maskName(j.email, maskEmails) || 'máy này'}`, 'success');
    } catch (e: any) {
      showToast('Kích hoạt thất bại: ' + (e?.message || e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    if (!genEmail.trim()) {
      showToast('Nhập email đăng ký để cấp key', 'error');
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch('/api/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', email: genEmail, days: Number(genDays) || 0, bindHwid: genBind }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      setGenKey(j.key);
      showToast('Đã tạo license key', 'success');
    } catch (e: any) {
      showToast('Lỗi tạo key: ' + (e?.message || e), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const remove = async () => {
    if (!confirm('Gỡ license khỏi máy này?')) return;
    await fetch('/api/license', { method: 'DELETE' });
    setLic(null);
    setFormKey('');
    showToast('Đã gỡ license — về bản community', 'info');
    refresh();
  };

  const badge = lic
    ? lic.type === 'expired'
      ? { text: 'Hết hạn', bg: 'var(--apple-red-dim)', color: 'var(--apple-red)' }
      : lic.type === 'invalid'
        ? { text: 'Không hợp lệ', bg: 'var(--apple-red-dim)', color: 'var(--apple-red)' }
        : lic.licensed
          ? { text: 'Licensed', bg: 'var(--apple-green-dim)', color: 'var(--apple-green)' }
          : { text: 'Community', bg: 'var(--apple-surface-hover, rgba(255,255,255,0.08))', color: 'var(--text-tertiary)' }
    : null;

  return (
    <div className="tab-surface">
      <div className="ov-card" style={{ maxWidth: 860 }}>
        <div className="ov-card-head">
          <div>
            <div className="ov-card-title">Thông tin bản quyền</div>
            <div className="ov-card-desc">
              License key chứa email + hạn + khóa HWID, ký HMAC-SHA256 — verify kiểm tra chữ ký thật, key sửa/giả sẽ bị từ chối.
            </div>
          </div>
          {badge && (
            <span className="tag-badge" style={{ background: badge.bg, color: badge.color, fontSize: 12, padding: '4px 12px' }}>
              ● {badge.text}
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <Field label="Sản phẩm" value={`${lic?.product || 'muse_gateway'} · v${lic?.version || '—'}`} />
          <Field label="Loại license" value={lic?.type || 'community'} />
          <Field
            label="Email đăng ký"
            value={lic?.email ? maskName(lic.email, maskEmails) : ''}
            onCopy={lic?.email ? () => copyText(lic.email, 'email đăng ký') : undefined}
          />
          <Field
            label="License Key"
            value={lic?.keyMasked || ''}
            onCopy={lic?.keyFull ? () => copyText(lic.keyFull, 'license key') : undefined}
          />
          <Field
            label="Hết hạn"
            value={lic?.expiresAt ? new Date(lic.expiresAt).toLocaleString('vi-VN') : lic?.licensed ? 'Không giới hạn' : ''}
            mono={false}
          />
          <Field
            label="HWID (máy này)"
            value={lic?.hwidMasked || ''}
            onCopy={lic?.hwid ? () => copyText(lic.hwid, 'HWID') : undefined}
          />
          {lic?.licensed && (
            <Field
              label="Khóa theo máy"
              value={lic.hwidBound ? 'Có — key chỉ chạy trên máy này' : 'Không — floating license'}
              mono={false}
            />
          )}
          {lic?.activatedAt && (
            <Field label="Kích hoạt lúc" value={new Date(lic.activatedAt).toLocaleString('vi-VN')} mono={false} />
          )}
        </div>

        {lic?.reason && !lic.licensed && lic.type !== 'community' && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--apple-red)' }}>⚠ {lic.reason}</div>
        )}

        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>
          Hỗ trợ: <span style={{ color: 'var(--text-secondary)' }}>Telegram</span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="apple-tool-btn" onClick={verify} disabled={verifying || !lic?.keyFull}>
            {verifying ? 'Đang kiểm tra…' : '↻ Kiểm tra lại'}
          </button>
          {lic?.keyFull && (
            <button type="button" className="apple-tool-btn" style={{ color: 'var(--apple-red)' }} onClick={remove}>
              Gỡ license khỏi máy này
            </button>
          )}
        </div>

        {/* Activation — single signed key (email/expiry/HWID embedded) */}
        {!lic?.licensed && (
          <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'stretch' }}>
            <input
              style={{ ...inputStyle, fontFamily: 'monospace' }}
              placeholder="Dán license key (MUSE1.…)"
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              spellCheck={false}
            />
            <button type="button" className="btn-apple-secondary" style={{ flexShrink: 0, whiteSpace: 'nowrap' }} onClick={activate} disabled={saving}>
              {saving ? 'Đang kiểm tra…' : '✓ Kích hoạt license'}
            </button>
          </div>
        )}

        {/* Key generator — vendor tool */}
        <div style={{ marginTop: 14 }}>
          <button type="button" className="apple-tool-btn" onClick={() => setGenOpen((v) => !v)}>
            {genOpen ? '▾ Ẩn tạo key' : '▸ Tạo license key mới'}
          </button>
          {genOpen && (
            <div
              style={{
                marginTop: 10,
                padding: 14,
                borderRadius: 10,
                border: '1px solid var(--apple-border-light)',
                background: 'var(--apple-surface)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px auto auto', gap: 10, alignItems: 'center' }}>
                <input
                  style={inputStyle}
                  placeholder="Email đăng ký"
                  value={genEmail}
                  onChange={(e) => setGenEmail(e.target.value)}
                />
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  placeholder="Số ngày"
                  title="Số ngày hiệu lực — 0 = vĩnh viễn"
                  value={genDays}
                  onChange={(e) => setGenDays(e.target.value)}
                />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={genBind} onChange={(e) => setGenBind(e.target.checked)} style={{ accentColor: 'var(--color-primary, #6c5ce7)' }} />
                  Khóa HWID máy này
                </label>
                <button type="button" className="btn-apple-secondary" onClick={generate} disabled={generating}>
                  {generating ? 'Đang tạo…' : 'Tạo key'}
                </button>
              </div>
              {genKey && (
                <div style={{ ...fieldBox, fontSize: 12, wordBreak: 'break-all', whiteSpace: 'normal', alignItems: 'flex-start' }}>
                  <span style={{ overflowWrap: 'anywhere' }}>{genKey}</span>
                  <button
                    type="button"
                    className="apple-tool-btn"
                    style={{ padding: '2px 8px', fontSize: 11, flexShrink: 0 }}
                    onClick={() => copyText(genKey, 'license key')}
                  >
                    Sao chép
                  </button>
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-quaternary)' }}>
                Hoặc CLI: <code>node scripts/gen-license.mjs --email … --days N --hwid HWID</code>
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-tertiary)' }}>
          Lần verify gần nhất:{' '}
          {lic?.lastVerifyAt ? (
            <>
              {new Date(lic.lastVerifyAt).toLocaleString('vi-VN')} —{' '}
              <span style={{ color: lic.lastVerifyOk ? 'var(--apple-green)' : 'var(--apple-red)' }}>
                {lic.lastVerifyOk ? 'Thành công!' : 'Thất bại'}
              </span>
            </>
          ) : (
            'chưa verify'
          )}
        </div>
      </div>
    </div>
  );
}
