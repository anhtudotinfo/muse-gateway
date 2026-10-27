'use client';

import React, { useState } from 'react';
import type { Profile } from '@/types';
import { useApp } from '@/components/AppShell';
import { maskName } from '@/lib/mask';
import { CookieInputDeck, splitCookieBlocks } from '@/components/CookieInputDeck';
import { ProfilesTab } from '@/components/tabs/ProfilesTab';

export default function AccountsPage() {
  const {
    showToast,
    cookieInput,
    setCookieInput,
    parsedMap,
    cookieCount,
    profiles,
    reloadProfiles,
    selectedBrowser,
    setSelectedBrowser,
    launchBrowser,
    deleteProfile,
    maskEmails,
  } = useApp();

  const [isLaunching, setIsLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState('Tự động nạp Cookie vào Chrome/Edge');
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

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setCookieInput(text);
        showToast('Đã dán từ clipboard', 'success');
      } else {
        showToast('Clipboard trống', 'error');
      }
    } catch {
      showToast('Vui lòng cấp quyền clipboard hoặc bấm Ctrl+V', 'error');
    }
  };

  const handleLoadSample = () => {
    if (profiles.length > 0) {
      setCookieInput(profiles[0].cookies);
      showToast(`Đã nạp: ${maskName(profiles[0].name, maskEmails)}`, 'success');
    } else {
      showToast('Chưa có session mẫu', 'error');
    }
  };

  const handleClear = () => {
    setCookieInput('');
    showToast('Đã xóa dữ liệu', 'info');
  };

  const handleLaunchBrowser = async () => {
    const raw = cookieInput.trim();
    if (!raw) {
      showToast('Vui lòng dán cookie trước khi mở trình duyệt', 'error');
      return;
    }

    setIsLaunching(true);
    setLaunchStatus('Đang mở trình duyệt & nạp session...');

    const res = await launchBrowser(splitCookieBlocks(raw)[0] || raw);
    if (res.ok) {
      showToast(`Đã mở thành công trên ${selectedBrowser === 'chrome' ? 'Chrome' : 'Edge'}`, 'success');
      setLaunchStatus('Đã mở thành công. Muse sẵn sàng.');
    } else {
      showToast(res.error || 'Lỗi khởi chạy trình duyệt', 'error');
      setLaunchStatus('Tự động nạp Cookie vào Chrome/Edge');
    }
    setTimeout(() => {
      setIsLaunching(false);
      setLaunchStatus(`Tự động nạp Cookie vào ${selectedBrowser === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'}`);
    }, 3000);
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

  const handleUseProfile = (profile: Profile) => {
    setCookieInput(profile.cookies);
    showToast(`Đã nạp hồ sơ: "${maskName(profile.name, maskEmails)}"`, 'success');
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
    <div className="accounts-stack">
      <CookieInputDeck
        cookieInput={cookieInput}
        onCookieChange={setCookieInput}
        parsedMap={parsedMap}
        cookieCount={cookieCount}
        selectedBrowser={selectedBrowser}
        onBrowserChange={setSelectedBrowser}
        isLaunching={isLaunching}
        launchStatus={launchStatus}
        onLaunch={handleLaunchBrowser}
        onPasteClipboard={handlePasteClipboard}
        onLoadSample={handleLoadSample}
        onClear={handleClear}
        onAddAccounts={handleAddAccounts}
        isAdding={isAdding}
        onLoginCapture={() => handleLoginCapture()}
        isCapturing={isCapturing}
        captureStatus={captureStatus}
      />
      <section className="apple-card">
        <ProfilesTab
          profiles={profiles}
          onRefresh={reloadProfiles}
          onUseProfile={handleUseProfile}
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
      </section>
    </div>
  );
}
