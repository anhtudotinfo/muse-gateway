'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/AppShell';
import { ActionsMenu } from '@/components/ActionsMenu';
import { HeaderSlot } from '@/components/HeaderSlot';
import { maskName } from '@/lib/mask';
import type { Profile } from '@/types';
import type { PoolAccountView } from '@/lib/musePool';

interface ProfilesTabProps {
  profiles: Profile[];
  onRefresh: () => void;
  /** Opens the Add account dialog. */
  onAdd: () => void;
  onDeleteProfile: (id: string, name: string) => void;
  onLaunchProfile?: (profile: Profile) => void;
  launchingProfileId?: string | null;
  /** Liveness check on one saved profile (POST /api/sessions/test). */
  onTestProfile?: (profile: Profile) => void;
  testingProfileId?: string | null;
  onTestAll?: () => void;
  onRenameProfile?: (profile: Profile) => void;
  /** Re-login flow — opens the capture browser targeted at this card so
   *  fresh cookies overwrite it instead of adding a duplicate. */
  onRelogin?: (profile: Profile) => void;
  /** True while a login-capture browser is open — cards show busy. */
  capturingProfileId?: string | null;
  onToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const AVATAR_COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#10b981', '#f97316'];

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function cookieInfo(cookies: string) {
  const parts = cookies.split(';').map((s) => s.trim()).filter(Boolean);
  return { count: parts.length, hasSess: /hatch_sess=/.test(cookies) };
}

export function ProfilesTab({
  profiles,
  onRefresh,
  onAdd,
  onDeleteProfile,
  onLaunchProfile,
  launchingProfileId,
  onTestProfile,
  testingProfileId,
  onTestAll,
  onRenameProfile,
  onRelogin,
  capturingProfileId,
  onToast,
}: ProfilesTabProps) {
  const { maskEmails } = useApp();
  const toast = onToast || (() => {});
  const [keepAlive, setKeepAlive] = useState(false);
  const [keepAliveMin, setKeepAliveMin] = useState(30);
  const [keeping, setKeeping] = useState(false);
  const [importing, setImporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  // Pool side of each account (cooldown, in-flight, request count) so one
  // card answers "can this account take work?" without the Pool tab.
  const [pool, setPool] = useState<Record<string, PoolAccountView>>({});

  const loadPool = async () => {
    try {
      const j = await fetch('/api/pool').then((r) => r.json());
      const map: Record<string, PoolAccountView> = {};
      for (const a of j.accounts || []) map[a.id] = a;
      setPool(map);
    } catch {}
  };

  useEffect(() => {
    void loadPool();
    const timer = setInterval(() => void loadPool(), 5000);
    return () => clearInterval(timer);
  }, []);

  const patchPool = async (body: Record<string, unknown>, done: string) => {
    try {
      const res = await fetch('/api/pool', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(res.statusText);
      toast(done, 'success');
      void loadPool();
    } catch (e: any) {
      toast('Lỗi cập nhật pool: ' + (e?.message || e), 'error');
    }
  };

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => {
        setKeepAlive(!!s.keepAliveEnabled);
        if (typeof s.keepAliveMin === 'number') setKeepAliveMin(s.keepAliveMin);
      })
      .catch(() => {});
  }, []);

  const toggleKeepAlive = async (v: boolean) => {
    setKeepAlive(v);
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepAliveEnabled: v }),
      });
      toast(v ? `Đã bật tự động keep-alive (${keepAliveMin}m)` : 'Đã tắt tự động keep-alive', 'info');
    } catch {
      toast('Lỗi lưu cài đặt keep-alive', 'error');
    }
  };

  const runKeepAliveAll = async () => {
    setKeeping(true);
    try {
      const res = await fetch('/api/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'keepAliveAll' }),
      });
      const j = await res.json();
      const ok = Object.values(j.results || {}).filter((v) => v === 'ok').length;
      toast(`Keep-alive xong: ${ok}/${Object.keys(j.results || {}).length} tài khoản ấm`, ok ? 'success' : 'error');
    } catch {
      toast('Lỗi keep-alive', 'error');
    } finally {
      setKeeping(false);
    }
  };

  const exportAccounts = async () => {
    try {
      const j = await (await fetch('/api/sessions/export')).json();
      const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `muse-accounts-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`Đã xuất ${j.sessions?.length || 0} tài khoản`, 'success');
    } catch {
      toast('Lỗi xuất tài khoản', 'error');
    }
  };

  const importAccounts = async (file: File) => {
    setImporting(true);
    try {
      const parsed = JSON.parse(await file.text());
      const res = await fetch('/api/sessions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      toast(`Đã nhập ${j.imported} tài khoản${j.skipped ? ` · bỏ qua ${j.skipped}` : ''}`, 'success');
      onRefresh();
    } catch (e: any) {
      toast('Lỗi nhập tài khoản: ' + (e?.message || e), 'error');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const backupAll = async () => {
    try {
      const j = await (await fetch('/api/backup')).json();
      const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `muse-backup-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`Đã sao lưu toàn bộ (${Object.keys(j.files || {}).length} file dữ liệu)`, 'success');
    } catch {
      toast('Lỗi sao lưu', 'error');
    }
  };

  const restoreBackup = async (file: File) => {
    if (!confirm(`Khôi phục backup từ "${file.name}"?\n\nSessions/pool/settings/keys hiện tại sẽ bị GHI ĐÈ bằng nội dung file backup.`)) {
      if (backupRef.current) backupRef.current.value = '';
      return;
    }
    setRestoring(true);
    try {
      const parsed = JSON.parse(await file.text());
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      toast(`Đã khôi phục: ${(j.restored || []).join(', ')}`, 'success');
      onRefresh();
    } catch (e: any) {
      toast('Lỗi khôi phục: ' + (e?.message || e), 'error');
    } finally {
      setRestoring(false);
      if (backupRef.current) backupRef.current.value = '';
    }
  };

  const setProxy = async (p: Profile) => {
    const cur = p.proxy || '';
    const input = prompt(
      `Proxy cho "${p.name}" — http://[user:pass@]host:port hoặc socks5://host:port\n(để trống = kết nối trực tiếp, "x" = xoá proxy)`,
      cur,
    );
    if (input === null) return;
    const v = input.trim();
    const proxy = v === '' || v.toLowerCase() === 'x' ? null : v;
    try {
      const res = await fetch(`/api/sessions/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxy }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      toast(proxy ? `Đã đặt proxy cho "${p.name}"` : `Đã xoá proxy của "${p.name}"`, 'success');
      onRefresh();
    } catch (e: any) {
      toast('Lỗi đặt proxy: ' + (e?.message || e), 'error');
    }
  };

  const now = Date.now();
  const ago = (ts: number) => {
    const ms = now - ts;
    if (ms < 60_000) return 'vừa xong';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} phút trước`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} giờ trước`;
    return `${Math.floor(ms / 86_400_000)} ngày trước`;
  };
  const fmtChecked = (iso?: string | null) =>
    iso
      ? `Kiểm tra ${new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`
      : 'Chưa kiểm tra';

  const poolOf = (id: string) => pool[id];
  const taking = profiles.filter((p) => {
    const a = poolOf(p.id);
    return a && a.enabled && a.cooldownRemainingMs <= 0;
  }).length;
  const cooling = profiles.filter((p) => (poolOf(p.id)?.cooldownRemainingMs ?? 0) > 0).length;
  const expired = profiles.filter((p) => p.lastStatus === 'invalid').length;

  return (
    <>
      <HeaderSlot>
        <button
          type="button"
          className="acc2-btn"
          onClick={() => onTestAll?.()}
          disabled={!profiles.length || !!testingProfileId}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
          </svg>
          {testingProfileId === 'all' ? 'Đang kiểm tra…' : 'Kiểm tra tất cả'}
        </button>
        <ActionsMenu
          title="Thao tác khác"
          items={[
            { label: keeping ? 'Đang ping…' : 'Ping giữ session ngay', disabled: keeping || !profiles.length, onClick: runKeepAliveAll },
            { label: 'Sao lưu toàn bộ (backup)', onClick: backupAll },
            { label: restoring ? 'Đang khôi phục…' : 'Khôi phục backup…', disabled: restoring, onClick: () => backupRef.current?.click() },
            { label: 'Xuất tài khoản (.json)', disabled: !profiles.length, onClick: exportAccounts },
            { label: importing ? 'Đang nhập…' : 'Nhập tài khoản…', disabled: importing, onClick: () => fileRef.current?.click() },
            { label: 'Làm mới', onClick: onRefresh },
          ]}
        />
        <button type="button" className="acc2-btn primary" onClick={onAdd}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Thêm tài khoản
        </button>
      </HeaderSlot>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => e.target.files?.[0] && importAccounts(e.target.files[0])}
      />
      <input
        ref={backupRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => e.target.files?.[0] && restoreBackup(e.target.files[0])}
      />

      <div className="acc2">
        <section className="acc2-summary" aria-label="Tóm tắt">
          <div className="acc2-summary-stats">
            <span><b>{profiles.length}</b> tài khoản</span>
            <span><b className="ok">{taking}</b> nhận request</span>
            <span><b>{cooling}</b> cooldown</span>
            <span><b className={expired ? 'bad' : ''}>{expired}</b> hết hạn</span>
          </div>
          <label className="acc2-check">
            <input type="checkbox" checked={keepAlive} onChange={(e) => toggleKeepAlive(e.target.checked)} />
            Giữ session sống — ping mỗi {keepAliveMin} phút
          </label>
        </section>

        <section className="acc2-card" aria-label="Danh sách tài khoản">
          {profiles.length === 0 ? (
            <div className="acc2-empty">
              <div className="acc2-empty-title">Chưa có tài khoản nào</div>
              <p>Thêm tài khoản Muse đầu tiên để pool bắt đầu nhận request.</p>
              <button type="button" className="acc2-btn primary" onClick={onAdd}>Thêm tài khoản</button>
            </div>
          ) : (
            <div className="acc2-scroll">
              <table className="acc2-table">
                <thead>
                  <tr>
                    <th>Tài khoản</th>
                    <th>Session</th>
                    <th>Trong pool</th>
                    <th className="num">Request</th>
                    <th>Dùng lần cuối</th>
                    <th><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => {
                    const { hasSess } = cookieInfo(p.cookies);
                    const a = poolOf(p.id);
                    const testing = testingProfileId === p.id || testingProfileId === 'all';
                    const capturing = capturingProfileId === p.id;
                    const session = testing
                      ? { cls: 'pending', label: 'Đang kiểm tra…' }
                      : p.lastStatus === 'valid'
                        ? { cls: 'ok', label: 'Còn sống' }
                        : p.lastStatus === 'invalid'
                          ? { cls: 'bad', label: 'Hết hạn' }
                          : hasSess
                            ? { cls: 'idle', label: 'Chưa kiểm tra' }
                            : { cls: 'bad', label: 'Thiếu cookie' };
                    const poolState = !a
                      ? { cls: 'idle', label: '—' }
                      : !a.enabled
                        ? { cls: 'idle', label: 'Tắt' }
                        : a.cooldownRemainingMs > 0
                          ? { cls: 'bad', label: `Cooldown ${Math.ceil(a.cooldownRemainingMs / 60000)} phút` }
                          : a.status === 'busy'
                            ? { cls: 'busy', label: 'Đang gửi' }
                            : { cls: 'ok', label: 'Nhận request' };
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="acc2-who">
                            <span className="acc2-avatar" style={{ background: avatarColor(p.name) }} aria-hidden="true">
                              {p.name.trim().charAt(0).toUpperCase()}
                            </span>
                            <div className="acc2-who-text">
                              <div className="acc2-name" title={maskEmails ? undefined : p.name}>{maskName(p.name, maskEmails)}</div>
                              <div className="acc2-sub">
                                {fmtChecked(p.lastTested)}
                                {p.proxy && <span className="acc2-tag" title={p.proxy}>proxy</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`acc2-pill ${session.cls}`}><span className="acc2-dot" />{session.label}</span>
                        </td>
                        <td>
                          <span className={`acc2-pool ${poolState.cls}`} title={a?.lastError || undefined}>{poolState.label}</span>
                        </td>
                        <td className="num">{a ? a.totalRequests : '—'}</td>
                        <td className="acc2-muted">{a && a.lastUsedAt > 0 ? ago(a.lastUsedAt) : '—'}</td>
                        <td>
                          <div className="acc2-actions">
                            {p.lastStatus === 'invalid' && onRelogin ? (
                              <button type="button" className="acc2-btn primary small" onClick={() => onRelogin(p)} disabled={capturing}>
                                {capturing ? 'Đang chờ…' : 'Đăng nhập lại'}
                              </button>
                            ) : (
                              onLaunchProfile && (
                                <button
                                  type="button"
                                  className="acc2-icon-btn"
                                  onClick={() => onLaunchProfile(p)}
                                  disabled={launchingProfileId === p.id}
                                  aria-label={`Mở Muse bằng ${maskName(p.name, maskEmails)}`}
                                  title="Mở trình duyệt"
                                >
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                                  </svg>
                                </button>
                              )
                            )}
                            {onTestProfile && (
                              <button
                                type="button"
                                className="acc2-icon-btn"
                                onClick={() => onTestProfile(p)}
                                disabled={testing}
                                aria-label="Kiểm tra session"
                                title="Kiểm tra session"
                              >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                  <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
                                </svg>
                              </button>
                            )}
                            <ActionsMenu
                              items={[
                                { label: 'Đổi tên…', onClick: () => onRenameProfile?.(p) },
                                { label: p.proxy ? 'Đổi proxy…' : 'Đặt proxy…', onClick: () => void setProxy(p) },
                                ...(a
                                  ? [
                                      a.enabled
                                        ? { label: 'Tạm tắt trong pool', onClick: () => void patchPool({ accountId: p.id, enabled: false }, 'Đã tắt tài khoản trong pool') }
                                        : { label: 'Bật lại trong pool', onClick: () => void patchPool({ accountId: p.id, enabled: true }, 'Đã bật tài khoản trong pool') },
                                      ...(a.cooldownRemainingMs > 0 || a.failCount > 0
                                        ? [{ label: 'Xoá cooldown', onClick: () => void patchPool({ accountId: p.id, resetCooldown: true }, 'Đã xoá cooldown') }]
                                        : []),
                                    ]
                                  : []),
                                ...(onRelogin ? [{ label: 'Đăng nhập lại (trình duyệt)', onClick: () => onRelogin(p) }] : []),
                                { label: 'Xóa tài khoản', danger: true, onClick: () => onDeleteProfile(p.id, p.name) },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
