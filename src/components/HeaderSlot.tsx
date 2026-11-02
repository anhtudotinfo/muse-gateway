'use client';

// Lets a page put its own controls in the shell's header row, next to the
// title (AppShell renders the #page-header-slot target).
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function HeaderSlot({ children }: { children: React.ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.getElementById('page-header-slot')), []);
  return el ? createPortal(children, el) : null;
}
