'use client';

import React from 'react';
import type { ToastItem } from '@/hooks/useToast';

interface AppleToastStageProps {
  toasts: ToastItem[];
}

export function AppleToastStage({ toasts }: AppleToastStageProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="apple-toast-stage">
      {toasts.map((t) => (
        <div key={t.id} className="apple-island-toast">
          <span className={`toast-badge-dot ${t.type}`}></span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
