'use client';

// Telegram bot setup — pasted token + defaults live in settings.json, the
// polling loop runs inside this gateway process (GET/PATCH /api/telegram).
// The token field is write-only: the API returns only a masked hint.
import React, { useEffect, useState, useCallback } from 'react';
import Button from '@/components/endpoint/ui/Button';
import Input from '@/components/endpoint/ui/Input';
import { useApp } from '@/components/AppShell';
import { useT } from '@/lib/i18n';

interface TgState {
  enabled: boolean;
  token_set: boolean;
  token_hint: string;
  ratio: string;
  duration_sec: number;
  allowed_chats: string;
  running: boolean;
  username: string | null;
  error: string | null;
}

const RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4'];
const safeJson = async (res: Response): Promise<any> => res.json().catch(() => ({}));

export function TelegramTab() {
  const { t } = useT();
  const { showToast } = useApp();
  const [state, setState] = useState<TgState | null>(null);
  const [token, setToken] = useState('');
  const [ratio, setRatio] = useState('9:16');
  const [durationSec, setDurationSec] = useState(10);
  const [allowedChats, setAllowedChats] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await safeJson(res);
      setState(j);
      setRatio(j.ratio || '9:16');
      setDurationSec(j.duration_sec || 10);
      setAllowedChats(j.allowed_chats || '');
    } catch {}
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 5000); // status (running/error) is live state
    return () => clearInterval(id);
  }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    const res = await fetch('/api/telegram', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const j = await safeJson(res);
    if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
    setState(j);
    return j as TgState;
  };

  const onSaveConfig = async () => {
    setSaving(true);
    try {
      const j = await save({
        token: token.trim() ? token.trim() : undefined,
        ratio,
        duration_sec: durationSec,
        allowed_chats: allowedChats,
      });
      if (token.trim()) setToken('');
      showToast(j.token_set ? t('Đã lưu cấu hình bot') : t('Đã lưu — chưa có token, bot chưa chạy được'), 'success');
    } catch (err: any) {
      showToast(err?.message || t('Lưu thất bại'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const onToggle = async () => {
    if (!state) return;
    setToggling(true);
    try {
      const j = await save({ enabled: !state.enabled });
      showToast(
        j.enabled ? t('Bot đã bật — đang kết nối Telegram') : t('Bot đã tắt'),
        'success',
      );
    } catch (err: any) {
      showToast(err?.message || t('Đổi trạng thái thất bại'), 'error');
    } finally {
      setToggling(false);
    }
  };

  const running = !!state?.running;
  const statusColor = !state?.enabled
    ? 'var(--text-muted, #9a9aad)'
    : running
      ? '#30d158'
      : '#ff9f0a';
  const statusText = !state
    ? t('Loading…')
    : !state.enabled
      ? t('Đang tắt')
      : running
        ? `@${state.username ?? '?'}`
        : state.error
          ? state.error
          : t('Đang kết nối…');

  return (
    <div className="pool-page">
      <section aria-label={t('Trạng thái bot')} className="acc2-card">
        <div className="pool-card-head">
          <div>
            <h2 className="pool-h2">{t('Bot Telegram')}</h2>
            <p className="pool-lead">
              {t('Chat với bot trên Telegram để tạo ảnh/video — bot chạy ngay trong gateway này, không cần server riêng hay webhook public.')}
            </p>
          </div>
          <div className="pool-head-right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span className="status-dot" style={{ background: statusColor }} />
              <span className="acc2-muted">{statusText}</span>
            </span>
            <Button
              variant={state?.enabled ? 'danger' : 'primary'}
              size="sm"
              loading={toggling}
              disabled={!state || (!state.enabled && !state.token_set)}
              onClick={onToggle}
            >
              {state?.enabled ? t('Tắt bot') : t('Bật bot')}
            </Button>
          </div>
        </div>
        {state?.enabled && state.error && (
          <p style={{ color: '#ff9f0a', fontSize: 13, margin: '4px 0 0' }}>{state.error}</p>
        )}
        {state?.enabled && running && state.username && (
          <p className="acc2-muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
            {t('Mở Telegram, chat với')} <a href={`https://t.me/${state.username}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand-500, #5e9bff)' }}>@{state.username}</a>
            {` — /vid <prompt> tạo video, /img <prompt> tạo ảnh.`}
          </p>
        )}
      </section>

      <section aria-label={t('Cấu hình bot')} className="acc2-card" style={{ marginTop: 14 }}>
        <h2 className="pool-h2">{t('Cấu hình')}</h2>
        <p className="pool-lead">
          {t('Tạo bot bằng @BotFather trên Telegram (lệnh /newbot), lấy token rồi dán vào đây.')}
        </p>
        <div style={{ display: 'grid', gap: 14, marginTop: 12, maxWidth: 520 }}>
          <Input
            label={t('Bot token')}
            type="password"
            placeholder={state?.token_set ? t('Đã lưu ({h}) — dán token mới để đổi', { h: state.token_hint }) : '123456:ABC-DEF…'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-main">{t('Tỉ lệ mặc định')}</label>
              <select
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
                className="w-full py-2.5 px-3 text-sm text-text-main bg-surface-2 rounded-[10px] border border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                {RATIOS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <Input
              label={t('Thời lượng video (giây)')}
              type="number"
              min={1}
              max={60}
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value) || 10)}
            />
          </div>
          <Input
            label={t('Chats được phép')}
            placeholder="123456789, 987654321"
            hint={t('Danh sách Telegram chat ID, cách nhau bằng dấu phẩy. Để trống = ai cũng dùng được. Khi bị chặn, bot tự trả lời kèm chat ID để bạn thêm vào đây.')}
            value={allowedChats}
            onChange={(e) => setAllowedChats(e.target.value)}
          />
          <div>
            <Button variant="primary" size="md" loading={saving} onClick={onSaveConfig}>
              {t('Lưu cấu hình')}
            </Button>
          </div>
        </div>
      </section>

      <section aria-label={t('Lệnh của bot')} className="acc2-card" style={{ marginTop: 14 }}>
        <h2 className="pool-h2">{t('Lệnh của bot')}</h2>
        <div className="acc2-muted" style={{ fontSize: 13, lineHeight: 1.9, marginTop: 6 }}>
          <div><code>/vid &lt;prompt&gt;</code> — {t('tạo video theo mặc định')}</div>
          <div><code>/vid 16:9 15s &lt;prompt&gt;</code> — {t('video tỉ lệ / thời lượng tùy chọn')}</div>
          <div><code>/img &lt;prompt&gt;</code> — {t('tạo ảnh')}</div>
          <div><code>/img 3 4:3 &lt;prompt&gt;</code> — {t('tạo 3 ảnh tỉ lệ 4:3')}</div>
          <div><code>&lt;prompt&gt;</code> — {t('gõ prompt trần = tạo video')}</div>
        </div>
        <p className="acc2-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          {t('Bot tạo task qua cùng pool tài khoản như API — cần ít nhất một account Muse còn phiên đăng nhập, và bot chỉ chạy khi gateway đang chạy.')}
        </p>
      </section>
    </div>
  );
}
