'use client';

import { use, useEffect, useState } from 'react';

// Approval page an app opens when it asks to connect. The user compares the
// code with the one the app shows, then allows or denies. Outside the
// dashboard shell on purpose: one question, nothing else to click.

interface PairView {
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'collected';
  app: string;
  code: string;
  origin: string;
}

export default function PairPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [pair, setPair] = useState<PairView | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/pair/${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setPair(await r.json());
      })
      .catch(() => setMissing(true));
  }, [id]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/pair/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve }),
      });
      const j = await r.json();
      if (pair) setPair({ ...pair, status: j.status ?? pair.status });
    } finally {
      setBusy(false);
    }
  };

  const done = pair && (pair.status === 'approved' || pair.status === 'collected');

  return (
    <main className="pair-page">
      <section className="pair-card" aria-live="polite">
        <img src="/muse-logo.svg" alt="" className="pair-logo" />
        {missing || pair?.status === 'expired' ? (
          <>
            <h1>Yêu cầu đã hết hạn</h1>
            <p className="pair-muted">Quay lại app và bấm kết nối lại.</p>
          </>
        ) : !pair ? (
          <p className="pair-muted">Đang tải…</p>
        ) : done ? (
          <>
            <h1>Đã kết nối {pair.app}</h1>
            <p className="pair-muted">Quay lại {pair.app} — app đã tự cấu hình xong. Bạn có thể đóng tab này.</p>
          </>
        ) : pair.status === 'denied' ? (
          <>
            <h1>Đã từ chối</h1>
            <p className="pair-muted">{pair.app} không được kết nối. Có thể thử lại từ app bất cứ lúc nào.</p>
          </>
        ) : (
          <>
            <h1>{pair.app} muốn kết nối Muse Gateway</h1>
            <p className="pair-muted">Kiểm tra mã này trùng với mã đang hiện trong {pair.app}.</p>
            <div className="pair-code">{pair.code}</div>
            <dl className="pair-meta">
              <dt>Từ</dt>
              <dd>{pair.origin}</dd>
              <dt>Được phép</dt>
              <dd>Tạo ảnh, video và chat bằng các tài khoản Muse của bạn</dd>
            </dl>
            <div className="pair-actions">
              <button type="button" className="acc2-btn" disabled={busy} onClick={() => decide(false)}>
                Từ chối
              </button>
              <button type="button" className="acc2-btn primary" disabled={busy} onClick={() => decide(true)}>
                Cho phép
              </button>
            </div>
            <p className="pair-foot">Thu hồi bất cứ lúc nào: Kết nối → API key → xoá key “{pair.app}”.</p>
          </>
        )}
      </section>
    </main>
  );
}
