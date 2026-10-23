'use client';

import React from 'react';

interface ApiGatewayTabProps {
  onCopyText: (text: string, label: string) => void;
  apiModel: string;
  onModelChange: (model: string) => void;
  apiStream: boolean;
  onStreamChange: (stream: boolean) => void;
  apiPrompt: string;
  onPromptChange: (prompt: string) => void;
  isTestingApi: boolean;
  onRunApiTest: () => void;
  apiResponse: string;
}

export function ApiGatewayTab({
  onCopyText,
  apiModel,
  onModelChange,
  apiStream,
  onStreamChange,
  apiPrompt,
  onPromptChange,
  isTestingApi,
  onRunApiTest,
  apiResponse,
}: ApiGatewayTabProps) {
  return (
    <div className="tab-surface">
      <div className="apple-guide-box">
        <span className="guide-pill-indicator">OPENAI COMPATIBLE GATEWAY</span>
        <h3 className="guide-heading">Kết Nối API Cho Phần Mềm Desktop</h3>
        <p className="caption-text" style={{ marginBottom: 16 }}>
          Hệ thống cung cấp chuẩn kết nối chuẩn 100% <strong>OpenAI Chat Completions API</strong>. Bạn có thể kết nối trực tiếp với <strong>Cherry Studio</strong>, <strong>Chatbox</strong>, <strong>NextChat</strong>, <strong>Cursor IDE</strong>, hoặc gọi qua Python/cURL.
        </p>

        {/* Main API Parameters Card */}
        <div className="api-config-board">
          <div className="api-param-row">
            <div className="param-label-group">
              <span className="param-tag">Base URL</span>
              <code className="param-value">http://localhost:3000/v1</code>
            </div>
            <button
              type="button"
              className="btn-copy-chip"
              onClick={() => onCopyText('http://localhost:3000/v1', 'Base URL')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy URL
            </button>
          </div>

          <div className="api-param-row">
            <div className="param-label-group">
              <span className="param-tag">API Key</span>
              <code className="param-value">sk-muse-session</code>
            </div>
            <button
              type="button"
              className="btn-copy-chip"
              onClick={() => onCopyText('sk-muse-session', 'API Key')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy Key
            </button>
          </div>

          <div className="api-param-row">
            <div className="param-label-group">
              <span className="param-tag">Model</span>
              <code className="param-value">muse-chat</code>
            </div>
            <button
              type="button"
              className="btn-copy-chip"
              onClick={() => onCopyText('muse-chat', 'Model ID')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy Model
            </button>
          </div>
        </div>

        {/* Desktop Apps Instructions Grid */}
        <h4 style={{ fontSize: '0.86rem', fontWeight: 600, color: '#ffffff', margin: '18px 0 10px' }}>
          Hướng Dẫn Cài Đặt Trên Các Ứng Dụng Desktop
        </h4>

        <div className="client-app-grid">
          <div className="client-app-card">
            <div className="app-card-title">
              <span>🍒</span> Cherry Studio
            </div>
            <p className="app-card-desc">
              1. Mở Cài đặt &rarr; <strong>Nhà cung cấp mô hình</strong>.<br />
              2. Chọn hoặc Thêm mới <strong>OpenAI</strong>.<br />
              3. API Base URL: <code>http://localhost:3000/v1</code><br />
              4. API Key: <code>sk-muse-session</code><br />
              5. Model ID: Nhập <code>muse-chat</code>
            </p>
          </div>

          <div className="client-app-card">
            <div className="app-card-title">
              <span>💬</span> Chatbox AI
            </div>
            <p className="app-card-desc">
              1. Mở Cài đặt &rarr; Chọn <strong>OpenAI API</strong>.<br />
              2. API Host: <code>http://localhost:3000</code><br />
              3. API Key: <code>sk-muse-session</code><br />
              4. Model: Chọn hoặc gõ <code>muse-chat</code>.<br />
              5. Bấm Lưu và bắt đầu chat!
            </p>
          </div>

          <div className="client-app-card">
            <div className="app-card-title">
              <span>🧭</span> Cursor / Continue
            </div>
            <p className="app-card-desc">
              Trong cấu hình config: Thêm custom OpenAI endpoint với <code>apiBase: &quot;http://localhost:3000/v1&quot;</code>, model <code>muse-chat</code>, apiKey <code>sk-muse-session</code>.
            </p>
          </div>

          <div className="client-app-card">
            <div className="app-card-title">
              <span>🌐</span> LobeChat / NextChat
            </div>
            <p className="app-card-desc">
              1. Cài đặt &rarr; OpenAI.<br />
              2. Proxy URL: <code>http://localhost:3000/v1</code><br />
              3. API Key: <code>sk-muse-session</code><br />
              4. Model: <code>muse-chat</code>
            </p>
          </div>
        </div>

        {/* Live API Playground */}
        <h4 style={{ fontSize: '0.86rem', fontWeight: 600, color: '#ffffff', margin: '20px 0 10px' }}>
          Thử Nghiệm Trực Tiếp API (Live Playground)
        </h4>

        <div className="api-playground-box">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>Model:</label>
              <select
                value={apiModel}
                onChange={(e) => onModelChange(e.target.value)}
                style={{
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid var(--apple-border)',
                  borderRadius: 'var(--radius-pill)',
                  color: '#ffffff',
                  padding: '3px 10px',
                  fontSize: '0.76rem',
                  outline: 'none',
                }}
              >
                <option value="muse-chat">muse-chat (Mặc định)</option>
                <option value="gpt-4o">gpt-4o (Alias)</option>
                <option value="claude-3-5-sonnet">claude-3-5-sonnet (Alias)</option>
                <option value="deepseek-chat">deepseek-chat (Alias)</option>
              </select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={apiStream}
                onChange={(e) => onStreamChange(e.target.checked)}
                style={{ accentColor: 'var(--apple-blue-vibrant)' }}
              />
              Stream Response (SSE)
            </label>
          </div>

          <div className="playground-input-row">
            <input
              type="text"
              className="playground-input"
              value={apiPrompt}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder="Nhập prompt thử nghiệm..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isTestingApi) {
                  onRunApiTest();
                }
              }}
            />
            <button
              type="button"
              className="btn-apple-primary"
              style={{ padding: '8px 16px', flex: 'none', borderRadius: 'var(--radius-md)', fontSize: '0.8rem' }}
              onClick={onRunApiTest}
              disabled={isTestingApi}
            >
              {isTestingApi ? 'Đang Xử Lý...' : 'Gửi Thử Nghiệm'}
            </button>
          </div>

          {apiResponse && (
            <div className="playground-terminal">
              {apiResponse}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
