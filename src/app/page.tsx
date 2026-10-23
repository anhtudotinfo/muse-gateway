'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { Profile, SessionTestResult, BrowserDetection } from '@/types';
import { useToast } from '@/hooks/useToast';
import { useCookieParser } from '@/hooks/useCookieParser';
import { AppleNavbar } from '@/components/AppleNavbar';
import { AppleToastStage } from '@/components/AppleToastStage';
import { SaveProfileModal } from '@/components/SaveProfileModal';
import { CookieInputDeck } from '@/components/CookieInputDeck';
import { ProfilesTab } from '@/components/tabs/ProfilesTab';
import { ApiGatewayTab } from '@/components/tabs/ApiGatewayTab';
import { BookmarkletTab } from '@/components/tabs/BookmarkletTab';
import { ExtensionTab } from '@/components/tabs/ExtensionTab';
import { TokenInspectorTab } from '@/components/tabs/TokenInspectorTab';

export default function MuseAppleApp() {
  const { toasts, showToast } = useToast();
  const [cookieInput, setCookieInput] = useState<string>('');
  const [selectedBrowser, setSelectedBrowser] = useState<'chrome' | 'edge'>('chrome');
  const [availableBrowsers, setAvailableBrowsers] = useState<BrowserDetection>({ chrome: null, edge: null });
  const [isLaunching, setIsLaunching] = useState<boolean>(false);
  const [launchStatus, setLaunchStatus] = useState<string>('Tự động nạp Cookie vào Chrome/Edge');

  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<SessionTestResult | null>(null);

  const [activeTab, setActiveTab] = useState<'profiles' | 'api' | 'bookmarklet' | 'extension' | 'inspector'>('profiles');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState<boolean>(false);
  const [modalProfileName, setModalProfileName] = useState<string>('');

  // API Playground State
  const [apiPrompt, setApiPrompt] = useState<string>('Xin chào! Hãy giới thiệu bạn là ai và hỗ trợ được những gì?');
  const [apiResponse, setApiResponse] = useState<string>('');
  const [isTestingApi, setIsTestingApi] = useState<boolean>(false);
  const [apiModel, setApiModel] = useState<string>('muse-chat');
  const [apiStream, setApiStream] = useState<boolean>(true);

  // Parse Cookie & Bookmarklet Scripts using custom hook
  const { parsedMap, parsedEntries, cookieCount, bookmarkletHref, consoleScript } = useCookieParser(cookieInput);

  // Load profiles from backend
  const loadProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setProfiles(Array.isArray(data) ? data : []);
      return data;
    } catch (e) {
      console.error(e);
      return [];
    }
  }, []);

  useEffect(() => {
    fetch('/api/browsers')
      .then((r) => r.json())
      .then((b) => setAvailableBrowsers(b))
      .catch((err) => console.warn(err));

    loadProfiles().then((list) => {
      if (list && list.length > 0 && !cookieInput) {
        setCookieInput(list[0].cookies);
      }
    });
  }, [loadProfiles]);

  // Actions
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
      showToast(`Đã nạp: ${profiles[0].name}`, 'success');
    } else {
      showToast('Chưa có session mẫu', 'error');
    }
  };

  const handleClear = () => {
    setCookieInput('');
    setTestResult(null);
    showToast('Đã xóa dữ liệu', 'info');
  };

  // Launch browser action
  const handleLaunchBrowser = async () => {
    const raw = cookieInput.trim();
    if (!raw) {
      showToast('Vui lòng dán cookie trước khi mở trình duyệt', 'error');
      return;
    }

    setIsLaunching(true);
    setLaunchStatus('Đang mở trình duyệt & nạp session...');

    try {
      const res = await fetch('/api/launch-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: raw, browserType: selectedBrowser }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Đã mở thành công trên ${selectedBrowser === 'chrome' ? 'Chrome' : 'Edge'}`, 'success');
        setLaunchStatus('Đã mở thành công. Muse sẵn sàng.');
      } else {
        showToast(data.error || 'Lỗi khởi chạy trình duyệt', 'error');
        setLaunchStatus('Tự động nạp Cookie vào Chrome/Edge');
      }
    } catch (err: any) {
      showToast('Lỗi kết nối tới máy chủ khởi chạy: ' + err.message, 'error');
      setLaunchStatus('Tự động nạp Cookie vào Chrome/Edge');
    } finally {
      setTimeout(() => {
        setIsLaunching(false);
        setLaunchStatus(`Tự động nạp Cookie vào ${selectedBrowser === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'}`);
      }, 3000);
    }
  };

  // Test session online
  const handleTestSession = async () => {
    const raw = cookieInput.trim();
    if (!raw) {
      showToast('Vui lòng dán cookie để kiểm tra', 'error');
      return;
    }

    setIsTesting(true);
    try {
      const res = await fetch('/api/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: raw }),
      });

      const result: SessionTestResult = await res.json();
      setTestResult(result);

      if (result.valid) {
        showToast('Session hợp lệ. Máy ảo đang RUNNING', 'success');
      } else {
        showToast(result.message || 'Session không hợp lệ hoặc đã hết hạn', 'error');
      }
    } catch (e: any) {
      showToast('Lỗi kiểm tra session: ' + e.message, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  // Profile management
  const handleOpenSaveModal = () => {
    if (!cookieInput.trim()) {
      showToast('Vui lòng nhập cookie trước khi lưu', 'error');
      return;
    }
    setModalProfileName(`Tài khoản ${profiles.length + 1}`);
    setSaveModalOpen(true);
  };

  const handleConfirmSave = async () => {
    const name = modalProfileName.trim();
    const raw = cookieInput.trim();
    if (!name) {
      showToast('Vui lòng nhập tên tài khoản', 'error');
      return;
    }

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cookies: raw }),
      });

      if (res.ok) {
        showToast(`Đã lưu "${name}"`, 'success');
        setSaveModalOpen(false);
        loadProfiles();
      } else {
        showToast('Lỗi khi lưu hồ sơ', 'error');
      }
    } catch (e: any) {
      showToast('Lỗi mạng khi lưu: ' + e.message, 'error');
    }
  };

  const handleDeleteProfile = async (id: string, name: string) => {
    if (confirm(`Bạn có chắc muốn xóa hồ sơ "${name}" không?`)) {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      showToast('Đã xóa hồ sơ', 'info');
      loadProfiles();
    }
  };

  const handleUseProfile = (profile: Profile) => {
    setCookieInput(profile.cookies);
    showToast(`Đã nạp hồ sơ: "${profile.name}"`, 'success');
  };

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`Đã sao chép ${label}`, 'success');
    });
  };

  // Run API Test in Playground
  const handleRunApiTest = async () => {
    if (!apiPrompt.trim()) {
      showToast('Vui lòng nhập câu hỏi thử nghiệm', 'error');
      return;
    }

    setIsTestingApi(true);
    setApiResponse('');

    try {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-muse-session',
        },
        body: JSON.stringify({
          model: apiModel,
          messages: [{ role: 'user', content: apiPrompt }],
          stream: apiStream,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP ${response.status}`);
      }

      if (apiStream && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullText = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const dataStr = trimmed.slice(6);
              if (dataStr === '[DONE]') break;
              try {
                const parsed = JSON.parse(dataStr);
                const delta = parsed.choices?.[0]?.delta?.content || '';
                fullText += delta;
                setApiResponse(fullText);
              } catch {}
            }
          }
        }
        showToast('API hoàn thành câu trả lời', 'success');
      } else {
        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content || JSON.stringify(data);
        setApiResponse(reply);
        showToast('Nhận phản hồi từ API thành công', 'success');
      }
    } catch (err: any) {
      showToast('Lỗi gọi API: ' + err.message, 'error');
      setApiResponse(`[Lỗi API]: ${err.message}`);
    } finally {
      setIsTestingApi(false);
    }
  };

  return (
    <>
      {/* Background Atmosphere */}
      <div className="apple-atmospheric">
        <div className="ambient-spot-1"></div>
        <div className="ambient-spot-2"></div>
      </div>

      {/* Floating Dynamic Island Toast */}
      <AppleToastStage toasts={toasts} />

      {/* Top Glass Navigation Bar */}
      <AppleNavbar availableBrowsers={availableBrowsers} />

      {/* Main Workspace Stage */}
      <main className="apple-main-stage">
        <div className="apple-grid-two-columns">
          {/* Left Column: Input Deck */}
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
            isTesting={isTesting}
            onTestSession={handleTestSession}
            testResult={testResult}
            onCloseTestResult={() => setTestResult(null)}
            onPasteClipboard={handlePasteClipboard}
            onLoadSample={handleLoadSample}
            onClear={handleClear}
            onOpenSaveModal={handleOpenSaveModal}
          />

          {/* Right Column: Apple Segmented Hub */}
          <section className="apple-card">
            {/* Apple Segmented Bar */}
            <nav className="apple-tab-bar" role="tablist">
              <button
                type="button"
                className={`tab-pill-btn ${activeTab === 'profiles' ? 'active' : ''}`}
                onClick={() => setActiveTab('profiles')}
              >
                Hồ Sơ ({profiles.length})
              </button>
              <button
                type="button"
                className={`tab-pill-btn ${activeTab === 'api' ? 'active' : ''}`}
                onClick={() => setActiveTab('api')}
              >
                API Desktop ⚡
              </button>
              <button
                type="button"
                className={`tab-pill-btn ${activeTab === 'bookmarklet' ? 'active' : ''}`}
                onClick={() => setActiveTab('bookmarklet')}
              >
                Bookmarklet
              </button>
              <button
                type="button"
                className={`tab-pill-btn ${activeTab === 'extension' ? 'active' : ''}`}
                onClick={() => setActiveTab('extension')}
              >
                Extension
              </button>
              <button
                type="button"
                className={`tab-pill-btn ${activeTab === 'inspector' ? 'active' : ''}`}
                onClick={() => setActiveTab('inspector')}
              >
                Chi Tiết Token
              </button>
            </nav>

            {/* Tab Views */}
            {activeTab === 'profiles' && (
              <ProfilesTab
                profiles={profiles}
                onRefresh={loadProfiles}
                onUseProfile={handleUseProfile}
                onDeleteProfile={handleDeleteProfile}
              />
            )}

            {activeTab === 'api' && (
              <ApiGatewayTab
                onCopyText={handleCopyText}
                apiModel={apiModel}
                onModelChange={setApiModel}
                apiStream={apiStream}
                onStreamChange={setApiStream}
                apiPrompt={apiPrompt}
                onPromptChange={setApiPrompt}
                isTestingApi={isTestingApi}
                onRunApiTest={handleRunApiTest}
                apiResponse={apiResponse}
              />
            )}

            {activeTab === 'bookmarklet' && (
              <BookmarkletTab
                bookmarkletHref={bookmarkletHref}
                consoleScript={consoleScript}
                onCopyConsoleCode={() => handleCopyText(consoleScript, 'Mã DevTools Console')}
              />
            )}

            {activeTab === 'extension' && (
              <ExtensionTab
                onCopyExtensionPath={() =>
                  handleCopyText('d:\\Workspace\\04_Tools-Agents\\muse\\extension', 'Đường dẫn Extension')
                }
              />
            )}

            {activeTab === 'inspector' && (
              <TokenInspectorTab parsedEntries={parsedEntries} />
            )}
          </section>
        </div>

        {/* Clean Footer */}
        <footer className="apple-footer">
          <p>Designed with Apple Human Interface Guidelines &bull; Next.js 16 App Router (TypeScript) &bull; Clean Architecture</p>
        </footer>
      </main>

      {/* Save Profile Modal Sheet */}
      <SaveProfileModal
        isOpen={saveModalOpen}
        profileName={modalProfileName}
        onNameChange={setModalProfileName}
        onClose={() => setSaveModalOpen(false)}
        onSave={handleConfirmSave}
      />
    </>
  );
}
