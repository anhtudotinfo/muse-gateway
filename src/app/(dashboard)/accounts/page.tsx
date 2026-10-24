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
      await deleteProfile(id);
      showToast('Đã xóa hồ sơ', 'info');
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
          onToast={showToast}
        />
      </section>
    </div>
  );
}
