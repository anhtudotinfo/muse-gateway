'use client';

import React, { useState } from 'react';
import type { Profile } from '@/types';
import { useApp } from '@/components/AppShell';
import { maskName } from '@/lib/mask';
import { AddAccountModal } from '@/components/AddAccountModal';
import { ProfilesTab } from '@/components/tabs/ProfilesTab';

export function AccountsList() {
  const {
    showToast,
    cookieInput,
    setCookieInput,
    profiles,
    reloadProfiles,
    selectedBrowser,
    setSelectedBrowser,
    launchBrowser,
    deleteProfile,
    maskEmails,
  } = useApp();

  const [addOpen, setAddOpen] = useState(false);
  const [launchingProfileId, setLaunchingProfileId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureStatus, setCaptureStatus] = useState('');
  const captureJobRef = React.useRef<{ jobId: string | null; timer: ReturnType<typeof setInterval> | null }>({ jobId: null, timer: null });

  const stopCapturePolling = () => {
    if (captureJobRef.current.timer) {
      clearInterval(captureJobRef.current.timer);
    }
    captureJobRef.current = { jobId: null, timer: null };
    setIsCapturing(false);
    setCaptureStatus('');
  };

  const [capturingProfileId, setCapturingProfileId] = useState<string | null>(null);

  const handleLoginCapture = async (targetSessionId?: string | null, targetName?: string) => {
    // Second click while waiting = cancel — server kills the browser.
    if (isCapturing) {
      const jobId = captureJobRef.current.jobId;
      stopCapturePolling();
      setCapturingProfileId(null);
      if (jobId) {
        fetch(`/api/login-capture?jobId=${jobId}`, { method: 'DELETE' }).catch(() => {});
      }
      showToast('Đã hủy phiên đăng nhập', 'info');
      return;
    }

    setIsCapturing(true);
    setCapturingProfileId(targetSessionId || null);
    setCaptureStatus('Đang mở trình duyệt…');
    try {
      const res = await fetch('/api/login-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ browserType: selectedBrowser, targetSessionId: targetSessionId || null }),
      });
      const j = await res.json();
      if (!res.ok || !j.jobId) {
        throw new Error(j.error || res.statusText);
      }
      captureJobRef.current.jobId = j.jobId;
      setCaptureStatus(
        targetName
          ? `Đăng nhập lại "${targetName}" — session tự cập nhật vào thẻ khi vào được trang chủ…`
          : 'Trình duyệt đã mở — đăng nhập Muse trong cửa sổ đó, session tự lưu khi vào được trang chủ…'
      );

      captureJobRef.current.timer = setInterval(async () => {
        const jobId = captureJobRef.current.jobId;
        if (!jobId) return;
        try {
          const r = await fetch(`/api/login-capture?jobId=${jobId}`);
          const s = await r.json();
          if (s.status === 'captured') {
            stopCapturePolling();
            setCapturingProfileId(null);
            setAddOpen(false);
            showToast(
              s.deduped
                ? 'Đã cập nhật session — cookies mới nhất'
                : 'Đăng nhập thành công — session đã lưu vào danh sách',
              'success',
            );
            reloadProfiles();
          } else if (s.status === 'closed') {
            stopCapturePolling();
            setCapturingProfileId(null);
            showToast('Cửa sổ trình duyệt đã đóng — chưa có session nào được lưu', 'info');
          } else if (s.status === 'error') {
            stopCapturePolling();
            setCapturingProfileId(null);
            showToast(s.error || 'Bắt session thất bại', 'error');
          }
        } catch {
          // Poll hiccup — keep waiting, the job may still succeed.
        }
      }, 2000);
    } catch (e: any) {
      stopCapturePolling();
      setCapturingProfileId(null);
      showToast(e?.message || 'Không khởi động được phiên đăng nhập', 'error');
    }
  };

  /** Save every cookie block, then sequentially liveness-test each new account. */
  const handleAddAccounts = async (blocks: string[]) => {
    if (!blocks.length || isAdding) return;
    setIsAdding(true);
    const ids: string[] = [];
    let added = 0;
    let dupes = 0;
    try {
      for (let i = 0; i < blocks.length; i++) {
        const name = `Tài khoản ${profiles.length + i + 1}`;
        try {
          const res = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, cookies: blocks[i] }),
          });
          const j = await res.json();
          if (j.deduped) {
            dupes++;
          } else if (res.ok && j.session?.id) {
            ids.push(j.session.id);
            added++;
          }
        } catch { /* keep going — report at the end */ }
      }
      if (!added) {
        showToast(dupes ? `Tài khoản đã tồn tại (${dupes} trùng)` : 'Không thêm được tài khoản nào', 'error');
        return;
      }
      setCookieInput('');
      setAddOpen(false);
      showToast(`Đã thêm ${added} tài khoản${dupes ? ` · bỏ qua ${dupes} trùng` : ''} — đang kiểm tra session…`, 'success');
      reloadProfiles();

      // Sequential liveness check on the newly added accounts.
      setTestingProfileId('all');
      let live = 0, dead = 0;
      for (const id of ids) {
        try {
          const res = await fetch('/api/sessions/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
          });
          const j = await res.json();
          if (j.valid) live++; else dead++;
          reloadProfiles();
        } catch {
          dead++;
        }
      }
      showToast(`Kiểm tra xong: ${live} LIVE · ${dead} DEAD`, dead ? 'error' : 'success');
    } finally {
      setTestingProfileId(null);
      setIsAdding(false);
      reloadProfiles();
    }
  };

  const handleTestProfile = async (profile: Profile) => {
    if (testingProfileId) return;
    setTestingProfileId(profile.id);
    try {
      const res = await fetch('/api/sessions/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: profile.id }),
      });
      const j = await res.json();
      if (res.ok) {
        showToast(
          j.valid
            ? `«${maskName(profile.name, maskEmails)}» LIVE${j.vm_state ? ` · VM ${j.vm_state}` : ''}`
            : `«${maskName(profile.name, maskEmails)}» DEAD — ${j.message || 'session hết hạn'}`,
          j.valid ? 'success' : 'error',
        );
      } else {
        showToast('Lỗi kiểm tra: ' + (j.error || res.statusText), 'error');
      }
    } catch (e: any) {
      showToast('Lỗi kiểm tra session: ' + (e?.message || e), 'error');
    } finally {
      setTestingProfileId(null);
      reloadProfiles();
    }
  };

  const handleTestAll = async () => {
    if (!profiles.length || testingProfileId) return;
    setTestingProfileId('all');
    let live = 0, dead = 0;
    for (const p of profiles) {
      try {
        const res = await fetch('/api/sessions/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: p.id }),
        });
        const j = await res.json();
        if (j.valid) live++; else dead++;
      } catch {
        dead++;
      }
      reloadProfiles();
    }
    setTestingProfileId(null);
    showToast(`Kiểm tra xong: ${live} LIVE · ${dead} DEAD`, dead ? 'error' : 'success');
    reloadProfiles();
  };

  const handleRenameProfile = async (profile: Profile) => {
    const name = prompt('Tên tài khoản mới:', profile.name)?.trim();
    if (!name || name === profile.name) return;
    try {
      const res = await fetch(`/api/sessions/${profile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || res.statusText);
      showToast(`Đã đổi tên → "${maskName(name, maskEmails)}"`, 'success');
      reloadProfiles();
    } catch (e: any) {
      showToast('Lỗi đổi tên: ' + (e?.message || e), 'error');
    }
  };

  const handleDeleteProfile = async (id: string, name: string) => {
    if (confirm(`Bạn có chắc muốn xóa hồ sơ "${maskName(name, maskEmails)}" không?`)) {
      const ok = await deleteProfile(id);
      showToast(ok ? 'Đã xóa hồ sơ' : 'Xóa hồ sơ thất bại — thử lại', ok ? 'info' : 'error');
    }
  };

  const handleLaunchProfile = async (profile: Profile) => {
    setLaunchingProfileId(profile.id);
    const res = await launchBrowser(profile.cookies);
    if (res.ok) {
      showToast(`Đã mở "${maskName(profile.name, maskEmails)}" trên ${selectedBrowser === 'chrome' ? 'Chrome' : 'Edge'}`, 'success');
    } else {
      showToast(res.error || 'Lỗi khởi chạy trình duyệt', 'error');
    }
    setLaunchingProfileId(null);
  };

  return (
    <>
      <ProfilesTab
        profiles={profiles}
        onRefresh={reloadProfiles}
        onAdd={() => setAddOpen(true)}
        onDeleteProfile={handleDeleteProfile}
        onLaunchProfile={handleLaunchProfile}
        launchingProfileId={launchingProfileId}
        onTestProfile={handleTestProfile}
        testingProfileId={testingProfileId}
        onTestAll={handleTestAll}
        onRenameProfile={handleRenameProfile}
        onRelogin={(p) => handleLoginCapture(p.id, p.name)}
        capturingProfileId={capturingProfileId}
        onToast={showToast}
      />
      <AddAccountModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        cookieInput={cookieInput}
        onCookieChange={setCookieInput}
        onAddAccounts={handleAddAccounts}
        isAdding={isAdding}
        selectedBrowser={selectedBrowser}
        onBrowserChange={setSelectedBrowser}
        onLoginCapture={() => handleLoginCapture()}
        isCapturing={isCapturing && !capturingProfileId}
        captureStatus={captureStatus}
      />
    </>
  );
}
