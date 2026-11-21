'use client';

// Telegram bot — rendered as one connect row inside the Endpoint addresses
// card (same pattern as Cloudflare tunnel / Tailscale). Token + defaults live
// in settings.json, the polling loop runs inside this gateway process
// (GET/PATCH /api/telegram). The token field is write-only: the API returns
// only a masked hint. Configuration opens in a modal so the page stays a
// compact list of ways to reach the gateway.
import React, { useEffect, useState, useCallback } from 'react';
import Button from '@/components/endpoint/ui/Button';
import Input from '@/components/endpoint/ui/Input';
import Modal from '@/components/endpoint/ui/Modal';
import { ConnectRow, type RowView } from '@/components/tabs/ConnectRow';
import { useApp } from '@/components/AppShell';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
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

const safeJson = async (res: Response): Promise<any> => res.json().catch(() => ({}));

export function TelegramSection() {
  const { t } = useT();
  const { showToast } = useApp();
  const { copied, copy } = useCopyToClipboard();
  const [state, setState] = useState<TgState | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [token, setToken] = useState('');
  const [allowedChats, setAllowedChats] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await safeJson(res);
      setState(j);
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
        allowed_chats: allowedChats,
      });
      if (token.trim()) setToken('');
      showToast(j.token_set ? t('Đã lưu cấu hình bot') : t('Đã lưu — chưa có token, bot chưa chạy được'), 'success');
      setShowSetup(false);
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
  const setupBtn = (
    <button type="button" className="acc2-btn" onClick={() => setShowSetup(true)}>
      {t('Cài đặt')}
    </button>
  );
  const toggleBtn = (
    <button
      type="button"
      className={`acc2-btn${state?.enabled ? '' : ' primary'}`}
      disabled={!state || toggling || (!state.enabled && !state.token_set)}
      onClick={onToggle}
    >
      {state?.enabled ? t('Tắt') : t('Bật')}
    </button>
  );

  const view: RowView = !state
    ? { state: t('Loading…'), tone: 'muted', busy: true, placeholder: '—', action: setupBtn }
    : state.enabled
      ? running
        ? {
            state: `@${state.username ?? '?'}`,
            tone: 'ok',
            url: state.username ? `https://t.me/${state.username}` : undefined,
            placeholder: t('Bot đang chạy'),
            action: <>{setupBtn}{toggleBtn}</>,
          }
        : {
            state: state.error ? t('Lỗi') : t('Đang kết nối…'),
            tone: state.error ? 'bad' : 'warn',
            busy: !state.error,
            placeholder: state.error ? '—' : t('Đang kết nối tới Telegram…'),
            action: <>{setupBtn}{toggleBtn}</>,
            note: state.error ? <p className="con-ep-note bad" role="alert">{state.error}</p> : undefined,
          }
      : {
          state: t('Chưa bật'),
          tone: 'muted',
          placeholder: state.token_set
            ? t('Bật để tạo ảnh/video từ Telegram')
            : t('Chưa có token — bấm Cài đặt để thêm'),
          action: <>{setupBtn}{toggleBtn}</>,
        };

  return (
    <>
      <ConnectRow name="Telegram bot" view={view} copyId="tg_link" copied={copied} onCopy={copy} />

      <Modal
        isOpen={showSetup}
        onClose={() => setShowSetup(false)}
        title="Telegram bot"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowSetup(false)}>{t('Đóng')}</Button>
            <Button variant="primary" loading={saving} onClick={onSaveConfig}>{t('Lưu cấu hình')}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <p className="acc2-muted" style={{ fontSize: 13, margin: 0 }}>
            {t('Tạo bot bằng @BotFather trên Telegram (lệnh /newbot), lấy token rồi dán vào đây — bot chạy ngay trong gateway này, không cần server riêng hay webhook.')}
          </p>
          <Input
            label={t('Bot token')}
            type="password"
            placeholder={state?.token_set ? t('Đã lưu ({h}) — dán token mới để đổi', { h: state.token_hint }) : '123456:ABC-DEF…'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <details className="acc2-muted" style={{ fontSize: 13 }}>
            <summary style={{ cursor: 'pointer', userSelect: 'none' }}>{t('Nâng cao')}</summary>
            <div style={{ marginTop: 10 }}>
              <Input
                label={t('Chats được phép')}
                placeholder="123456789, 987654321"
                hint={t('Danh sách Telegram chat ID, cách nhau bằng dấu phẩy. Để trống = ai cũng dùng được. Khi bị chặn, bot tự trả lời kèm chat ID để bạn thêm vào đây.')}
                value={allowedChats}
                onChange={(e) => setAllowedChats(e.target.value)}
              />
            </div>
          </details>
          <details className="acc2-muted" style={{ fontSize: 13 }}>
            <summary style={{ cursor: 'pointer', userSelect: 'none' }}>{t('Lệnh của bot')}</summary>
            <div style={{ lineHeight: 1.9, marginTop: 8 }}>
              <div><code>/vid &lt;prompt&gt;</code> — {t('tạo video theo mặc định')}</div>
              <div><code>/vid 16:9 15s &lt;prompt&gt;</code> — {t('video tỉ lệ / thời lượng tùy chọn (dọc/ngang/vuông cũng được)')}</div>
              <div><code>/img &lt;prompt&gt;</code> / <code>/img 3 4:3 &lt;prompt&gt;</code> — {t('tạo ảnh, tối đa 4 ảnh/lần')}</div>
              <div><code>&lt;prompt&gt;</code> — {t('prompt trần hiểu ý định: "tạo ảnh mèo" → ảnh, "quay mèo" → video')}</div>
              <div>{t('Gửi kèm 1 ảnh = ảnh tham chiếu (img2img / image-to-video)')}</div>
              <div style={{ marginTop: 6 }}>
                {t('Bot tạo task qua cùng pool tài khoản như API — cần ít nhất một account Muse còn phiên đăng nhập, và bot chỉ chạy khi gateway đang chạy. Trong group, bot chỉ trả lời khi được gọi lệnh, tag @bot hoặc reply tin nhắn của nó.')}
              </div>
            </div>
          </details>
        </div>
      </Modal>
    </>
  );
}
