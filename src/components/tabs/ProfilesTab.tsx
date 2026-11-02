'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/AppShell';
import { ActionsMenu } from '@/components/ActionsMenu';
import { maskName } from '@/lib/mask';
import type { Profile } from '@/types';
import type { PoolAccountView } from '@/lib/musePool';

interface ProfilesTabProps {
  profiles: Profile[];
  onRefresh: () => void;
  onUseProfile: (profile: Profile) => void;
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
  onUseProfile,
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

  return (
    <div className="tab-surface">
      <div className="ov-card-head">
        <div>
          <div className="ov-card-title">Tài khoản đã lưu <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>({profiles.length})</span></div>
          <div className="ov-card-desc">Mở trực tiếp hoặc nạp lại vào ô nhập phía trên.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <label
            className="apple-tool-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
            title={`Ping session mỗi ${keepAliveMin} phút giữ cookie ấm`}
          >
            <input
              type="checkbox"
              checked={keepAlive}
              onChange={(e) => toggleKeepAlive(e.target.checked)}
              style={{ accentColor: 'var(--color-primary, #6c5ce7)' }}
            />
            Keep-alive {keepAliveMin}m
          </label>
          <ActionsMenu
            items={[
              {
                label: keeping ? 'Đang ping…' : '⚡ Keep-alive tất cả',
                disabled: keeping,
                onClick: runKeepAliveAll,
              },
              {
                label: testingProfileId === 'all' ? 'Đang kiểm tra…' : 'Kiểm tra tất cả',
                disabled: !profiles.length || testingProfileId === 'all',
                onClick: () => onTestAll?.(),
              },
              {
                label: 'Sao lưu toàn bộ (backup)',
                onClick: backupAll,
              },
              {
                label: restoring ? 'Đang khôi phục…' : 'Khôi phục backup…',
                disabled: restoring,
                onClick: () => backupRef.current?.click(),
              },
              {
                label: 'Xuất tài khoản (.json)',
                disabled: !profiles.length,
                onClick: exportAccounts,
              },
              {
                label: importing ? 'Đang nhập…' : 'Nhập tài khoản…',
                disabled: importing,
                onClick: () => fileRef.current?.click(),
              },
              { label: 'Làm mới', onClick: onRefresh },
            ]}
          />
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
        </div>
      </div>

      {profiles.length === 0 ? (
        <div className="ov-empty">
          Chưa có tài khoản nào được lưu.
          <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--text-quaternary)' }}>
            Dán cookie ở trên (mỗi dòng 1 tài khoản) rồi bấm «Thêm tài khoản».
          </div>
        </div>
      ) : (
        <div className="acc-grid">
          {profiles.map((p) => {
            const { count, hasSess } = cookieInfo(p.cookies);
            const busy = launchingProfileId === p.id;
            const testing = testingProfileId === p.id || testingProfileId === 'all';
            // Liveness badge: LIVE / DEAD after a check, else cookie-shape hint.
            const badge = testing
              ? { cls: 'running', label: 'Đang kiểm tra…' }
              : p.lastStatus === 'valid'
                ? { cls: 'done', label: 'LIVE' }
                : p.lastStatus === 'invalid'
                  ? { cls: 'failed', label: 'DEAD' }
                  : hasSess
                    ? { cls: 'done', label: 'Session' }
                    : { cls: 'running', label: 'Thiếu sess' };
            return (
              <div key={p.id} className="acc-card">
                <div className="acc-card-top">
                  <span className="acc-avatar" style={{ background: avatarColor(p.name) }}>
                    {p.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="acc-name-block">
                    <div className="acc-name" title={maskEmails ? undefined : p.name}>{maskName(p.name, maskEmails)}</div>
                    <div className="acc-sub">
                      Muse session{p.lastTested ? ` · test ${new Date(p.lastTested).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
                    </div>
                  </div>
                  <span className={`ov-status-chip ${badge.cls}`}>{badge.label}</span>
                </div>

                {pool[p.id] && (() => {
                  const a = pool[p.id];
                  const state = !a.enabled
                    ? { cls: 'off', label: 'Tắt trong pool' }
                    : a.cooldownRemainingMs > 0
                      ? { cls: 'failed', label: `Cooldown ${Math.ceil(a.cooldownRemainingMs / 60000)} phút` }
                      : a.status === 'busy'
                        ? { cls: 'running', label: 'Đang gửi' }
                        : { cls: 'done', label: 'Nhận request' };
                  const busyLanes = a.lanes?.lanes.filter((l) => l.busy).length ?? 0;
                  return (
                    <div className="acc-pool-row">
                      <span className={`acc-pool-state ${state.cls}`}>{state.label}</span>
                      <span>{a.totalRequests} request</span>
                      {busyLanes > 0 && <span>{busyLanes} luồng đang chạy</span>}
                      {a.lastError && a.failCount > 0 && (
                        <span className="acc-pool-error" title={a.lastError}>{a.lastError}</span>
                      )}
                    </div>
                  );
                })()}

                <div className="acc-meta-row">
                  <span>{count} cookies</span>
                  <span>·</span>
                  <span>{new Date(p.updatedAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  {p.proxy && (
                    <>
                      <span>·</span>
                      <span title={p.proxy} style={{ color: 'var(--color-primary, #6c5ce7)' }}>⇄ proxy</span>
                    </>
                  )}
                </div>

                <div className="acc-card-actions">
                  {onRelogin && p.lastStatus === 'invalid' ? (
                    <button
                      type="button"
                      className="acc-btn primary"
                      onClick={() => onRelogin(p)}
                      disabled={capturingProfileId === p.id}
                      title="Mở trình duyệt — đăng nhập lại, session tự cập nhật vào thẻ này"
                    >
                      {capturingProfileId === p.id ? 'Đang chờ…' : '🔐 Đăng nhập lại'}
                    </button>
                  ) : (
                    onLaunchProfile && (
                      <button
                        type="button"
                        className="acc-btn primary"
                        onClick={() => onLaunchProfile(p)}
                        disabled={busy}
                        title="Mở trình duyệt với tài khoản này"
                      >
                        {busy ? 'Đang mở…' : '▶ Mở'}
                      </button>
                    )
                  )}
                  {onTestProfile && (
                    <button
                      type="button"
                      className="acc-btn"
                      onClick={() => onTestProfile(p)}
                      disabled={testing}
                      title="Kiểm tra session còn sống không"
                    >
                      {testing ? 'Đang test…' : '↻ Kiểm tra'}
                    </button>
                  )}
                  <ActionsMenu
                    items={[
                      { label: 'Nạp vào ô nhập', onClick: () => onUseProfile(p) },
                      { label: 'Đổi tên…', onClick: () => onRenameProfile?.(p) },
                      { label: p.proxy ? 'Đổi proxy…' : 'Đặt proxy…', onClick: () => void setProxy(p) },
                      ...(pool[p.id]
                        ? [
                            pool[p.id].enabled
                              ? { label: 'Tạm tắt trong pool', onClick: () => void patchPool({ accountId: p.id, enabled: false }, 'Đã tắt tài khoản trong pool') }
                              : { label: 'Bật lại trong pool', onClick: () => void patchPool({ accountId: p.id, enabled: true }, 'Đã bật tài khoản trong pool') },
                            ...(pool[p.id].cooldownRemainingMs > 0 || pool[p.id].failCount > 0
                              ? [{ label: 'Xoá cooldown', onClick: () => void patchPool({ accountId: p.id, resetCooldown: true }, 'Đã xoá cooldown') }]
                              : []),
                          ]
                        : []),
                      ...(onRelogin ? [{ label: 'Đăng nhập lại (trình duyệt)', onClick: () => onRelogin(p) }] : []),
                      { label: 'Xóa tài khoản', danger: true, onClick: () => onDeleteProfile(p.id, p.name) },
                    ]}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
