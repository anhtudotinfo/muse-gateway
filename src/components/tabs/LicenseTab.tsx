'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppShell';
import { maskName } from '@/lib/mask';
import type { LicenseView } from '@/lib/license';
import { useT } from '@/lib/i18n';

const STORE_URL = 'https://www.storetiki.online';
const SUPPORT_URL = 'https://t.me/storetiki_bot';

/** The key's middle part is base64 of the payload, which carries the buyer
 *  email — show only its ends. Copy buttons still copy the full key. */
function shortKey(key: string): string {
  if (!key) return '';
  return key.length > 18 ? `${key.slice(0, 10)}•••••••••${key.slice(-4)}` : '•••••••••';
}

function daysLeft(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function DetailRow({
  label,
  value,
  mono = false,
  onCopy,
  copyLabel,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
  copyLabel: string;
}) {
  return (
    <div className="lic-row">
      <span className="lic-row-label">{label}</span>
      <span className={`lic-row-value${mono ? ' mono' : ''}`} title={mono ? undefined : value}>
        {value || '—'}
      </span>
      <span className="lic-row-action">
        {onCopy && (
          <button type="button" className="acc2-btn small" onClick={onCopy} aria-label={`${copyLabel} ${label}`}>
            {copyLabel}
          </button>
        )}
      </span>
    </div>
  );
}

export function LicenseTab() {
  const { maskEmails, copyText, showToast } = useApp();
  const { t } = useT();
  const [lic, setLic] = useState<LicenseView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [formKey, setFormKey] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const j = await (await fetch('/api/license')).json();
      setLic(j);
    } catch {
    } finally {
      setLoaded(true);
    }
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

  const activate = async (e?: React.FormEvent) => {
    e?.preventDefault();
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
    showToast(t('Đã gỡ license — về bản miễn phí'), 'info');
    refresh();
  };

  // Hero: what state the machine is in, and when it runs out.
  const tone = lic?.licensed ? 'ok' : lic && (lic.type === 'expired' || lic.type === 'invalid') ? 'bad' : '';
  const title = lic?.licensed
    ? t('Pro · đang hoạt động')
    : lic?.type === 'expired'
      ? t('License đã hết hạn')
      : lic?.type === 'invalid'
        ? t('License không hợp lệ')
        : t('Chưa kích hoạt');
  const expiry = lic?.expiresAt
    ? (() => {
        const date = new Date(lic.expiresAt).toLocaleDateString();
        const days = daysLeft(lic.expiresAt);
        return days > 0
          ? t('Hết hạn {date} · còn {n} ngày', { date, n: days })
          : t('Hết hạn từ {date}', { date });
      })()
    : lic?.licensed
      ? t('Không giới hạn thời gian')
      : t('Bản miễn phí — đủ mọi tính năng. Kích hoạt key để nhận URL cố định.');

  const copyLabel = t('Sao chép');

  return (
    <div className="lic">
      {!loaded ? (
        <section className="ov2-card lic-hero" aria-busy="true">
          <span className="skeleton lic-hero-icon" />
          <div className="lic-hero-text">
            <span className="skeleton lic-skel-line wide" />
            <span className="skeleton lic-skel-line" />
          </div>
        </section>
      ) : (
        <section className="ov2-card lic-hero" aria-label={t('Trạng thái bản quyền')}>
          <div className="lic-hero-main">
            <span className={`lic-hero-icon ${tone}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {lic?.licensed ? (
                  <path d="M9 12l2 2 4-4M12 22c-4 0-7-3.6-7-8V6.5L12 4l7 2.5V14c0 4.4-3 8-7 8z" />
                ) : (
                  <path d="M12 9v4M12 17h.01M12 22c-4 0-7-3.6-7-8V6.5L12 4l7 2.5V14c0 4.4-3 8-7 8z" />
                )}
              </svg>
            </span>
            <div className="lic-hero-text">
              <div className="lic-hero-title">{title}</div>
              <div className="acc2-muted">{expiry}</div>
            </div>
          </div>
          <div className="lic-hero-actions">
            <button type="button" className="acc2-btn" onClick={verify} disabled={verifying || !lic?.keyFull}>
              {verifying ? t('Đang kiểm tra…') : t('Kiểm tra lại')}
            </button>
            <a className="acc2-btn primary" href={STORE_URL} target="_blank" rel="noreferrer">
              {lic?.licensed ? t('Gia hạn') : t('Nhận key')}
            </a>
          </div>
          {lic?.reason && !lic.licensed && lic.type !== 'community' && (
            <p className="lic-reason" role="alert">{lic.reason}</p>
          )}
        </section>
      )}

      {loaded && lic?.licensed && (
        <section className="acc2-card lic-details" aria-label={t('Chi tiết bản quyền')}>
          <DetailRow
            label={t('Sản phẩm')}
            value={`${lic.product || 'muse_gateway'} · v${lic.version || '—'}`}
            copyLabel={copyLabel}
          />
          <DetailRow
            label={t('Email đăng ký')}
            value={lic.email ? maskName(lic.email, maskEmails) : ''}
            onCopy={lic.email ? () => copyText(lic.email, t('email đăng ký')) : undefined}
            copyLabel={copyLabel}
          />
          <DetailRow
            label={t('License Key')}
            value={shortKey(lic.keyFull)}
            mono
            onCopy={lic.keyFull ? () => copyText(lic.keyFull, t('license key')) : undefined}
            copyLabel={copyLabel}
          />
          <DetailRow
            label={t('Mã máy (HWID)')}
            value={lic.hwidMasked}
            mono
            onCopy={lic.hwid ? () => copyText(lic.hwid, 'HWID') : undefined}
            copyLabel={copyLabel}
          />
          <DetailRow
            label={t('Khóa theo máy')}
            value={lic.hwidBound ? t('Có — key chỉ chạy trên máy này') : t('Không — floating license')}
            copyLabel={copyLabel}
          />
          {lic.activatedAt && (
            <DetailRow
              label={t('Kích hoạt lúc')}
              value={new Date(lic.activatedAt).toLocaleString()}
              copyLabel={copyLabel}
            />
          )}
          <div className="lic-verify">
            {t('Lần kiểm tra gần nhất:')}{' '}
            {lic.lastVerifyAt ? (
              <>
                {new Date(lic.lastVerifyAt).toLocaleString()} ·{' '}
                <span className={lic.lastVerifyOk ? 'lic-ok' : 'lic-bad'}>
                  {lic.lastVerifyOk ? t('thành công') : t('thất bại')}
                </span>
              </>
            ) : (
              t('chưa kiểm tra')
            )}
          </div>
        </section>
      )}

      {/* Activation — single signed key (email/expiry/HWID embedded) */}
      {loaded && !lic?.licensed && (
        <section className="acc2-card lic-activate" aria-label={t('Kích hoạt license')}>
          <p className="lic-notice">
            {t('Mọi tính năng đều miễn phí. License key dùng để cấp tunnel URL cố định riêng cho gateway của bạn — nhận key tại {site} hoặc nhắn Telegram {tg}, rồi dán vào ô bên dưới.', {
              site: 'storetiki.online',
              tg: '@storetiki_bot',
            })}
          </p>
          <form className="lic-form" onSubmit={activate}>
            <label htmlFor="lic-key" className="lic-label">{t('License Key')}</label>
            <div className="lic-form-row">
              <input
                id="lic-key"
                className="lic-input"
                placeholder={t('Dán license key (MUSE1.…)')}
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="submit" className="acc2-btn primary" disabled={saving}>
                {saving ? t('Đang kiểm tra…') : t('Kích hoạt license')}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="lic-support" aria-label={t('Hỗ trợ')}>
        <span>
          {t('Nhận key:')}{' '}
          <a className="ov2-link" href={STORE_URL} target="_blank" rel="noreferrer">storetiki.online</a>
        </span>
        <span>
          {t('Hỗ trợ:')}{' '}
          <a className="ov2-link" href={SUPPORT_URL} target="_blank" rel="noreferrer">Telegram @storetiki_bot</a>
        </span>
      </section>

      {lic?.keyFull && (
        <section className="lic-danger" aria-label={t('Gỡ bản quyền')}>
          <div>
            <div className="lic-danger-title">{t('Gỡ license khỏi máy này')}</div>
            <div className="acc2-muted">{t('URL cố định cấp theo license sẽ ngừng cho tới khi kích hoạt lại. Các tính năng khác vẫn dùng bình thường.')}</div>
          </div>
          <button type="button" className="acc2-btn lic-danger-btn" onClick={remove}>
            {t('Gỡ license')}
          </button>
        </section>
      )}
    </div>
  );
}
