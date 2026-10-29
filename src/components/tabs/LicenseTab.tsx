'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppShell';
import { maskName } from '@/lib/mask';
import type { LicenseView } from '@/lib/license';
import { useT } from '@/lib/i18n';

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

function Field({ label, value, mono = true, onCopy, copyLabel }: { label: string; value: string; mono?: boolean; onCopy?: () => void; copyLabel?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={fieldLabel}>{label}</div>
      <div style={{ ...fieldBox, fontFamily: mono ? 'monospace' : 'inherit' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</span>
        {onCopy && (
          <button type="button" className="apple-tool-btn" style={{ padding: '2px 8px', fontSize: 11, flexShrink: 0 }} onClick={onCopy}>
            {copyLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function LicenseTab() {
  const { maskEmails, copyText, showToast } = useApp();
  const { t } = useT();
  const [lic, setLic] = useState<LicenseView | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [formKey, setFormKey] = useState('');
  const [saving, setSaving] = useState(false);

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
      showToast(j.ok ? `Verify: ${j.reason}` : `${t('Kích hoạt thất bại:')} ${j.reason}`, j.ok ? 'success' : 'error');
    } catch {
      showToast(t('Lỗi verify license'), 'error');
    } finally {
      setVerifying(false);
    }
  };

  const activate = async () => {
    if (!formKey.trim()) {
      showToast(t('Dán license key trước'), 'error');
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
      showToast(t('Đã kích hoạt license cho {x}', { x: maskName(j.email, maskEmails) || t('máy này') }), 'success');
    } catch (e: any) {
      showToast(t('Kích hoạt thất bại:') + ' ' + (e?.message || e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(t('Gỡ license khỏi máy này?'))) return;
    await fetch('/api/license', { method: 'DELETE' });
    setLic(null);
    setFormKey('');
    showToast(t('Đã gỡ license — về bản community'), 'info');
    refresh();
  };

  const badge = lic
    ? lic.type === 'expired'
      ? { text: t('Hết hạn'), bg: 'var(--apple-red-dim)', color: 'var(--apple-red)' }
      : lic.type === 'invalid'
        ? { text: t('Không hợp lệ'), bg: 'var(--apple-red-dim)', color: 'var(--apple-red)' }
        : lic.licensed
          ? { text: t('Licensed'), bg: 'var(--apple-green-dim)', color: 'var(--apple-green)' }
          : { text: t('Community'), bg: 'var(--apple-surface-hover, rgba(255,255,255,0.08))', color: 'var(--text-tertiary)' }
    : null;

  return (
    <div className="tab-surface">
      <div className="ov-card" style={{ maxWidth: 860, margin: '0 auto' }}>
        <div className="ov-card-head">
          <div>
            <div className="ov-card-title">{t('Thông tin bản quyền')}</div>
            <div className="ov-card-desc">
              {t('License key chứa email + hạn + khóa HWID, ký Ed25519 — verify kiểm tra chữ ký thật, key sửa/giả sẽ bị từ chối.')}
            </div>
          </div>
          {badge && (
            <span className="tag-badge" style={{ background: badge.bg, color: badge.color, fontSize: 12, padding: '4px 12px' }}>
              ● {badge.text}
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <Field label={t('Sản phẩm')} value={`${lic?.product || 'muse_gateway'} · v${lic?.version || '—'}`} />
          <Field label={t('Loại license')} value={lic?.type || 'community'} />
          <Field
            label={t('Email đăng ký')}
            value={lic?.email ? maskName(lic.email, maskEmails) : ''}
            onCopy={lic?.email ? () => copyText(lic.email, t('email đăng ký')) : undefined}
            copyLabel={t('Sao chép')}
          />
          <Field
            label={t('License Key')}
            value={lic?.keyMasked || ''}
            onCopy={lic?.keyFull ? () => copyText(lic.keyFull, t('license key')) : undefined}
            copyLabel={t('Sao chép')}
          />
          <Field
            label={t('Hết hạn')}
            value={lic?.expiresAt ? new Date(lic.expiresAt).toLocaleString() : lic?.licensed ? t('Không giới hạn') : ''}
            mono={false}
          />
          <Field
            label={t('HWID (máy này)')}
            value={lic?.hwidMasked || ''}
            onCopy={lic?.hwid ? () => copyText(lic.hwid, 'HWID') : undefined}
            copyLabel={t('Sao chép')}
          />
          {lic?.licensed && (
            <Field
              label={t('Khóa theo máy')}
              value={lic.hwidBound ? t('Có — key chỉ chạy trên máy này') : t('Không — floating license')}
              mono={false}
            />
          )}
          {lic?.activatedAt && (
            <Field label={t('Kích hoạt lúc')} value={new Date(lic.activatedAt).toLocaleString()} mono={false} />
          )}
        </div>

        {lic?.reason && !lic.licensed && lic.type !== 'community' && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--apple-red)' }}>⚠ {lic.reason}</div>
        )}

        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>
          {t('Mua key:')}{' '}
          <a href="https://www.storetiki.online" target="_blank" rel="noreferrer" style={{ color: 'var(--apple-blue, #0a84ff)' }}>
            storetiki.online
          </a>
          {' '}· {t('Hỗ trợ:')}{' '}
          <a href="https://t.me/ministoretiki_bbqqvv_bot" target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)' }}>
            Telegram @ministoretiki_bbqqvv_bot
          </a>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="apple-tool-btn" onClick={verify} disabled={verifying || !lic?.keyFull}>
            {verifying ? t('Đang kiểm tra…') : t('↻ Kiểm tra lại')}
          </button>
          {lic?.keyFull && (
            <button type="button" className="apple-tool-btn" style={{ color: 'var(--apple-red)' }} onClick={remove}>
              {t('Gỡ license khỏi máy này')}
            </button>
          )}
        </div>

        {/* Unlicensed notice — tell users the gateway API is locked and where to buy */}
        {!lic?.licensed && (
          <div
            style={{
              marginTop: 14,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(255,159,10,0.10)',
              border: '1px solid rgba(255,159,10,0.35)',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--apple-orange, #ff9f0a)',
            }}
          >
            {t('Gateway API {api} đang khóa — mọi request trả {code}. Mua license key tại {site} hoặc nhắn Telegram {tg}, rồi dán key vào ô bên dưới.', {
              api: '/v1/*',
              code: '402 license_required',
              site: 'storetiki.online',
              tg: '@ministoretiki_bbqqvv_bot',
            })}
          </div>
        )}

        {/* Activation — single signed key (email/expiry/HWID embedded) */}
        {!lic?.licensed && (
          <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'stretch' }}>
            <input
              style={{ ...inputStyle, fontFamily: 'monospace' }}
              placeholder={t('Dán license key (MUSE1.…)')}
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              spellCheck={false}
            />
            <button type="button" className="btn-apple-secondary" style={{ flexShrink: 0, whiteSpace: 'nowrap' }} onClick={activate} disabled={saving}>
              {saving ? t('Đang kiểm tra…') : t('✓ Kích hoạt license')}
            </button>
          </div>
        )}

        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-tertiary)' }}>
          {t('Lần verify gần nhất:')}{' '}
          {lic?.lastVerifyAt ? (
            <>
              {new Date(lic.lastVerifyAt).toLocaleString()} —{' '}
              <span style={{ color: lic.lastVerifyOk ? 'var(--apple-green)' : 'var(--apple-red)' }}>
                {lic.lastVerifyOk ? t('Thành công!') : t('Thất bại')}
              </span>
            </>
          ) : (
            t('chưa verify')
          )}
        </div>
      </div>
    </div>
  );
}
