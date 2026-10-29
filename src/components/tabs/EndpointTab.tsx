'use client';

// Port of 9router's EndpointPageClient — adapted to muse's API surface.
// Backed by: GET/POST/PATCH/DELETE /api/keys (+ ?reveal=<id>), /api/settings,
// /api/health, and /api/tunnel/* (cloudflared quick tunnel + Tailscale funnel).
// Per-key "Restrict access" is persisted on the key record and enforced by
// the /v1/* handlers (403 on a disallowed model).

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Card from '@/components/endpoint/ui/Card';
import Button from '@/components/endpoint/ui/Button';
import Input from '@/components/endpoint/ui/Input';
import Modal, { ConfirmModal } from '@/components/endpoint/ui/Modal';
import Toggle from '@/components/endpoint/ui/Toggle';
import { CardSkeleton } from '@/components/endpoint/ui/Loading';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import {
  TUNNEL_BENEFITS,
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
  STATUS_POLL_FAST_MS,
  REACHABLE_MISS_THRESHOLD,
  CLIENT_PING_FAST_MS,
  UNREACHABLE_FAIL_MS,
} from '@/components/endpoint/endpointConstants';
import { clientPingUrl, clientPingAny } from '@/components/endpoint/endpointPing';
import EndpointRow from '@/components/endpoint/EndpointRow';
import StatusAlert, { type StatusAlertStatus } from '@/components/endpoint/StatusAlert';
import HelpTooltip from '@/components/endpoint/HelpTooltip';
import SecurityWarning from '@/components/endpoint/SecurityWarning';
import KeyAccessControls from '@/components/endpoint/KeyAccessControls';
import KeySnippetModal from '@/components/endpoint/KeySnippetModal';
import type { EndpointKey, KeyAccess } from '@/components/endpoint/types';

// Per-key "Restrict access" rules are persisted on the key record
// (PATCH /api/keys {id, access}) and enforced by /v1/* handlers.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const safeJson = async (res: Response): Promise<any> => res.json().catch(() => ({}));

// /api/settings persists { requireLogin, hasPassword, tunnelDashboardAccess }.
const fetchSettings = async () => {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) return await res.json();
  } catch { /* backend pending */ }
  return { requireLogin: true, hasPassword: false, tunnelDashboardAccess: false };
};

const patchSettings = async (patch: Record<string, unknown>) => {
  try {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) return await res.json();
  } catch { /* backend pending — local state still updated by caller */ }
  return patch;
};

interface EndpointTabProps {
  onCopyText?: (text: string, label: string) => void;
  onOpenSettings?: () => void;
}

export function EndpointTab({ onCopyText, onOpenSettings }: EndpointTabProps) {
  const [keys, setKeys] = useState<EndpointKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const [requireApiKey, setRequireApiKey] = useState(false);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
  const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);
  const [dashboardToken, setDashboardToken] = useState('');

  // Cloudflare Tunnel state
  const [tunnelChecking, setTunnelChecking] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelReachable, setTunnelReachable] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState('');
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState('');
  const [tunnelStatus, setTunnelStatus] = useState<StatusAlertStatus | null>(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);
  // Named tunnel (fixed hostname): token from Cloudflare Zero Trust +
  // the public hostname configured there. Empty token = quick tunnel.
  const [namedToken, setNamedToken] = useState('');
  const [namedPublicUrl, setNamedPublicUrl] = useState('');

  // Tailscale state
  const [tsEnabled, setTsEnabled] = useState(false);
  const [tsReachable, setTsReachable] = useState(false);
  const [tsUrl, setTsUrl] = useState('');
  const [tsLoading, setTsLoading] = useState(false);
  const [tsProgress, setTsProgress] = useState('');
  const [tsStatus, setTsStatus] = useState<StatusAlertStatus | null>(null);
  const [tsAuthUrl, setTsAuthUrl] = useState('');
  const [tsAuthLabel, setTsAuthLabel] = useState('');
  const [tsInstalled, setTsInstalled] = useState<boolean | null>(null); // null=checking
  const [tsInstalling, setTsInstalling] = useState(false);
  const [tsInstallLog, setTsInstallLog] = useState<string[]>([]);
  const [tsConnecting, setTsConnecting] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState(false);
  const tsLogRef = useRef<HTMLDivElement>(null);

  // Debounce reachable=false: server may briefly return false during background refresh.
  const tunnelMissRef = useRef(0);
  const tsMissRef = useRef(0);
  // Browser-side reachable cache (independent of backend DNS quirks)
  const tunnelClientReachableRef = useRef(false);
  const tsClientReachableRef = useRef(false);
  // Track whether reachable=true was ever observed in this session.
  const tunnelEverReachableRef = useRef(false);
  const tsEverReachableRef = useRef(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState(false);
  const [tsEverReachable, setTsEverReachable] = useState(false);
  // When the unreachable streak began — drives the check→failed UI deadline.
  const tunnelDownSinceRef = useRef<number | null>(null);
  const tsDownSinceRef = useRef<number | null>(null);
  const [, setCheckTick] = useState(0);

  // API key visibility toggle state
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  // Lazily fetched full key values (list endpoint returns masked keys)
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  // Per-key access rules live on the key record server-side (enforced by /v1/*)

  // Client-side local/remote detection (UI hint only, not a security gate)
  const [isRemoteHost, setIsRemoteHost] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined')
      setIsRemoteHost(!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname));
  }, []);

  const { copied, copy } = useCopyToClipboard();
  const copyWithToast = useCallback(
    (text: string, id: string, label?: string) => {
      copy(text, id);
      onCopyText?.(text, label || 'endpoint');
    },
    [copy, onCopyText]
  );

  // Security gate: block remote exposure while dashboard uses default password or login is off.
  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? 'Enable "Require login" and set a custom password before activating the tunnel.'
    : 'Change the default dashboard password before activating the tunnel.';

  // Auto-scroll install log
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  useEffect(() => {
    fetchData();
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Status poll: only while degraded (not yet reachable). Stop once healthy to avoid spam.
  // Visibility re-check: refresh once when tab becomes visible.
  useEffect(() => {
    const anyEnabled = tunnelEnabled || tsEnabled;
    if (!anyEnabled) return;
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    const allHealthy = tunnelHealthy && tsHealthy;
    const onVisible = () => { if (!document.hidden) syncTunnelStatus(); };
    document.addEventListener('visibilitychange', onVisible);
    if (allHealthy) return () => document.removeEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => { if (!document.hidden) syncTunnelStatus(); }, STATUS_POLL_FAST_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tunnelEnabled, tsEnabled, tunnelReachable, tsReachable]);

  // Browser-side periodic ping: probes tunnel/tailscale URLs directly so UI stays
  // "reachable" even when backend DNS (1.1.1.1) hiccups on *.ts.net or *.trycloudflare.com.
  // Adaptive: fast when degraded; pause when tab hidden.
  useEffect(() => {
    const probeBoth = async () => {
      if (document.hidden) return;
      if (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) {
        const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
        tunnelClientReachableRef.current = ok;
        if (ok) { tunnelMissRef.current = 0; tunnelDownSinceRef.current = null; setTunnelReachable(true); if (!tunnelEverReachableRef.current) { tunnelEverReachableRef.current = true; setTunnelEverReachable(true); } }
        else { tunnelMissRef.current += 1; if (tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD) { if (tunnelDownSinceRef.current == null) tunnelDownSinceRef.current = Date.now(); setTunnelReachable(false); } }
      } else {
        tunnelClientReachableRef.current = false;
        if (tunnelEnabled && tunnelDownSinceRef.current == null) tunnelDownSinceRef.current = Date.now();
      }
      if (tsEnabled && tsUrl) {
        const ok = await clientPingUrl(tsUrl);
        tsClientReachableRef.current = ok;
        if (ok) { tsMissRef.current = 0; tsDownSinceRef.current = null; setTsReachable(true); if (!tsEverReachableRef.current) { tsEverReachableRef.current = true; setTsEverReachable(true); } }
        else { tsMissRef.current += 1; if (tsMissRef.current >= REACHABLE_MISS_THRESHOLD) { if (tsDownSinceRef.current == null) tsDownSinceRef.current = Date.now(); setTsReachable(false); } }
      } else {
        tsClientReachableRef.current = false;
        if (tsEnabled && tsDownSinceRef.current == null) tsDownSinceRef.current = Date.now();
      }
    };
    const anyEnabled = (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) || (tsEnabled && tsUrl);
    if (!anyEnabled) return;
    probeBoth();
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    if (tunnelHealthy && tsHealthy) return;
    const id = setInterval(probeBoth, CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [tunnelEnabled, tunnelUrl, tunnelPublicUrl, tsEnabled, tsUrl, tunnelReachable, tsReachable]);

  // Deadline bookkeeping: clear streaks when tunnels are disabled, and tick a
  // re-render every 10s while anything is down so the check→failed transition
  // fires on time instead of spinning "checking…" forever.
  useEffect(() => {
    if (!tunnelEnabled) tunnelDownSinceRef.current = null;
    if (!tsEnabled) tsDownSinceRef.current = null;
    const anyDown = (tunnelEnabled && !tunnelReachable) || (tsEnabled && !tsReachable);
    if (!anyDown) return;
    const id = setInterval(() => setCheckTick((t) => t + 1), 10000);
    return () => clearInterval(id);
  }, [tunnelEnabled, tsEnabled, tunnelReachable, tsReachable]);

  const tunnelTimedOut =
    tunnelEnabled && !tunnelReachable && tunnelDownSinceRef.current != null &&
    Date.now() - tunnelDownSinceRef.current > UNREACHABLE_FAIL_MS;
  const tsTimedOut =
    tsEnabled && !tsReachable && tsDownSinceRef.current != null &&
    Date.now() - tsDownSinceRef.current > UNREACHABLE_FAIL_MS;

  // Client-side reachable only (server no longer probes; watchdog handles backend health).
  // Miss-debounce: only flip to false after N consecutive misses.
  const updateReachable = useCallback(
    (
      _unused: unknown,
      clientRef: React.RefObject<boolean>,
      missRef: React.RefObject<number>,
      setter: (v: boolean) => void,
      everRef: React.RefObject<boolean>,
      everSetter: (v: boolean) => void
    ) => {
      const reachable = clientRef.current;
      if (reachable) {
        missRef.current = 0;
        setter(true);
        if (!everRef.current) {
          everRef.current = true;
          everSetter(true);
        }
      } else {
        missRef.current += 1;
        if (missRef.current >= REACHABLE_MISS_THRESHOLD) setter(false);
      }
    },
    []
  );

  // Trust user intent (settingsEnabled): UI stays "enabled" while watchdog restarts process
  const syncTunnelStatus = async () => {
    try {
      const statusRes = await fetch('/api/tunnel/status', { cache: 'no-store' });
      if (!statusRes.ok) return;
      const data = await safeJson(statusRes);
      const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
      const tUrl = data.tunnel?.tunnelUrl || '';
      setTunnelUrl(tUrl);
      setTunnelPublicUrl(data.tunnel?.publicUrl || '');
      setTunnelEnabled(tEnabled);
      updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

      const tsEn = data.tailscale?.settingsEnabled ?? data.tailscale?.enabled ?? false;
      const tsUrlVal = data.tailscale?.tunnelUrl || '';
      setTsUrl(tsUrlVal);
      setTsEnabled(tsEn);
      updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
    } catch { /* ignore poll errors */ }
  };

  const loadSettings = async () => {
    setTunnelChecking(true);
    try {
      const [settingsData, statusRes] = await Promise.all([
        fetchSettings(),
        fetch('/api/tunnel/status', { cache: 'no-store' }).catch(() => null),
      ]);
      if (settingsData) {
        setRequireLogin(settingsData.requireLogin !== false);
        setHasPassword(settingsData.hasPassword || false);
        setTunnelDashboardAccess(settingsData.tunnelDashboardAccess || false);
        setDashboardToken(settingsData.dashboardToken || '');
      }
      if (statusRes?.ok) {
        const data = await safeJson(statusRes);
        const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
        const tUrl = data.tunnel?.tunnelUrl || '';
        setTunnelUrl(tUrl);
        setTunnelPublicUrl(data.tunnel?.publicUrl || '');
        setTunnelEnabled(tEnabled);
        updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

        const tsEn = data.tailscale?.settingsEnabled ?? data.tailscale?.enabled ?? false;
        const tsUrlVal = data.tailscale?.tunnelUrl || '';
        setTsUrl(tsUrlVal);
        setTsEnabled(tsEn);
        updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
      }
    } catch (error) {
      console.log('Error loading settings:', error);
    } finally {
      setTunnelChecking(false);
    }
  };

  const handleTunnelDashboardAccess = async (value: boolean) => {
    const updated = await patchSettings({ tunnelDashboardAccess: value });
    if (updated) {
      setTunnelDashboardAccess(value);
      if (updated.dashboardToken) setDashboardToken(updated.dashboardToken);
    }
  };

  const handleRequireApiKey = async (value: boolean) => {
    try {
      const res = await fetch('/api/keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireAuth: value }),
      });
      if (res.ok) setRequireApiKey(value);
    } catch (error) {
      console.log('Error updating requireApiKey:', error);
    }
  };

  const fetchData = async () => {
    try {
      const fetchKeys = async (): Promise<EndpointKey[]> => {
        const res = await fetch('/api/keys');
        if (!res.ok) return [];
        const data = await safeJson(res);
        if (typeof data.requireAuth === 'boolean') setRequireApiKey(data.requireAuth);
        return (data.keys || []).map((k: { id: string; name: string; key: string; enabled?: boolean; createdAt: number; lastUsedAt?: number; access?: KeyAccess }) => ({
          id: k.id,
          name: k.name,
          key: k.key, // masked server-side
          isActive: k.enabled !== false,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
          access: k.access,
        }));
      };

      let existing = await fetchKeys();
      // Auto-provision a default key for first-time users so the endpoint works out of the box.
      if (existing.length === 0) {
        try {
          const createRes = await fetch('/api/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Default Key' }),
          });
          if (createRes.ok) existing = await fetchKeys();
        } catch { /* fall through to empty render */ }
      }
      setKeys(existing);
    } catch (error) {
      console.log('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  // ─── Cloudflare Tunnel handlers
  // Ping tunnel health until reachable. Race multiple URLs (shortlink + direct) — 1 OK is enough.
  const pingTunnelHealth = async (...urls: (string | undefined)[]) => {
    setTunnelLoading(true);
    setTunnelProgress('Waiting for tunnel ready...');
    const targets = urls.filter(Boolean).map((u) => `${u}/api/health`);
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      const ok = await Promise.any(targets.map(async (h) => {
        const p = await fetch(h, { mode: 'cors', cache: 'no-store' });
        if (p.ok) return true;
        throw new Error('not ready');
      })).catch(() => false);
      if (ok) {
        setTunnelEnabled(true);
        setTunnelLoading(false);
        setTunnelProgress('');
        return true;
      }
      // Every 5 pings (~10s), check if backend process still alive
      if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
        try {
          const statusRes = await fetch('/api/tunnel/status');
          if (statusRes.ok) {
            const status = await safeJson(statusRes);
            if (!status.tunnel?.enabled) {
              setTunnelStatus({ type: 'error', message: 'Tunnel process stopped unexpectedly.' });
              setTunnelLoading(false);
              setTunnelProgress('');
              return false;
            }
          }
        } catch { /* ignore */ }
      }
    }
    setTunnelStatus({ type: 'error', message: 'Tunnel created but not reachable. Please try again.' });
    setTunnelLoading(false);
    setTunnelProgress('');
    return false;
  };

  const startTunnel = async (overrides?: { token?: string; publicUrl?: string }) => {
    setShowEnableTunnelModal(false);
    setTunnelLoading(true);
    setTunnelStatus(null);
    setTunnelProgress('Creating tunnel...');

    // Poll download progress while enable request is pending
    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        try {
          const r = await fetch('/api/tunnel/status');
          if (r.ok) {
            const s = await safeJson(r);
            if (s.download?.downloading) {
              setTunnelProgress(`Downloading cloudflared... ${s.download.progress}%`);
            } else if (polling) {
              setTunnelProgress('Creating tunnel...');
            }
          }
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    pollProgress();

    try {
      const token = (overrides?.token ?? namedToken).trim();
      const publicUrl = (overrides?.publicUrl ?? namedPublicUrl).trim();
      const res = await fetch('/api/tunnel/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          token ? { token, publicUrl } : {}
        ),
      });
      polling = false;
      const data = await safeJson(res);
      if (!res.ok) {
        setTunnelStatus({ type: 'error', message: (data.error as string) || `Tunnel backend unavailable (HTTP ${res.status})` });
        return;
      }

      const url = data.tunnelUrl as string;
      if (!url) {
        setTunnelStatus({ type: 'error', message: 'No tunnel URL returned' });
        return;
      }

      setTunnelUrl(url);
      setTunnelPublicUrl((data.publicUrl as string) || '');
      await pingTunnelHealth(data.publicUrl as string, url);
    } catch (error) {
      setTunnelStatus({ type: 'error', message: (error as Error).message });
    } finally {
      polling = false;
      setTunnelLoading(false);
      setTunnelProgress('');
    }
  };

  // Vendor-branded URL: the license server provisions a named tunnel
  // (u-<keyId>.<vendor domain>) for this license and hands back the
  // connector token + public hostname — no Cloudflare account needed.
  const [provisioning, setProvisioning] = useState(false);
  const [licensed, setLicensed] = useState<boolean | null>(null);
  const [showAdvTunnel, setShowAdvTunnel] = useState(false);
  useEffect(() => {
    fetch('/api/license')
      .then((r) => r.json())
      .then((j) => setLicensed(Boolean(j?.licensed)))
      .catch(() => setLicensed(false));
  }, []);

  const handleProvisionTunnel = async (): Promise<{ token: string; publicUrl: string } | null> => {
    setProvisioning(true);
    setTunnelStatus(null);
    try {
      const res = await fetch('/api/tunnel/provision', { method: 'POST' });
      const data = await safeJson(res);
      if (!res.ok || !data.tunnelToken) {
        setTunnelStatus({ type: 'error', message: (data.error as string) || `Provision failed (HTTP ${res.status})` });
        return null;
      }
      const out = { token: String(data.tunnelToken), publicUrl: String(data.publicUrl || '') };
      setNamedToken(out.token);
      setNamedPublicUrl(out.publicUrl);
      return out;
    } catch (error) {
      setTunnelStatus({ type: 'error', message: (error as Error).message });
      return null;
    } finally {
      setProvisioning(false);
    }
  };

  // One-click customer path: provision the per-license tunnel then start it —
  // token/public URL never touch the form.
  const handleProvisionAndStart = async () => {
    const p = await handleProvisionTunnel();
    if (p) await startTunnel(p);
  };

  const handleEnableTunnel = async () => startTunnel();

  const handleDisableTunnel = async () => {
    setTunnelLoading(true);
    setTunnelStatus(null);
    try {
      const res = await fetch('/api/tunnel/disable', { method: 'POST' });
      const data = await safeJson(res);
      if (res.ok) {
        setTunnelEnabled(false);
        setTunnelUrl('');
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: 'success', message: 'Tunnel disabled' });
      } else {
        setTunnelStatus({ type: 'error', message: (data.error as string) || 'Failed to disable tunnel' });
      }
    } catch (error) {
      setTunnelStatus({ type: 'error', message: (error as Error).message });
    } finally {
      setTunnelLoading(false);
    }
  };

  // ─── Tailscale handlers
  const checkTailscaleInstalled = async () => {
    setTsInstalled(null);
    try {
      const res = await fetch('/api/tunnel/tailscale-check');
      if (res.ok) {
        const data = await safeJson(res);
        setTsInstalled(!!data.installed);
        return data;
      }
    } catch { /* ignore */ }
    setTsInstalled(false);
    return { installed: false };
  };

  const handleInstallTailscale = async () => {
    setTsInstalling(true);
    setTsStatus(null);
    setTsInstallLog([]);
    try {
      const res = await fetch('/api/tunnel/tailscale-install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sudoPassword: '' }),
      });
      if (!res.ok || !res.body) {
        const data = await safeJson(res);
        setTsStatus({ type: 'error', message: (data.error as string) || `Tailscale backend unavailable (HTTP ${res.status})` });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const lines = part.split('\n');
          let event = 'progress';
          let data: { message?: string; error?: string } | null = null;
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            if (line.startsWith('data: ')) {
              try { data = JSON.parse(line.slice(6)); } catch { /* skip */ }
            }
          }
          if (!data) continue;
          if (event === 'progress') {
            setTsInstallLog((prev) => [...prev.slice(-50), data.message || '']);
          } else if (event === 'done') {
            setTsInstalled(true);
            setTsInstalling(false);
            setShowTsModal(false);
            handleConnectTailscale();
            return;
          } else if (event === 'error') {
            setTsStatus({ type: 'error', message: data.error || 'Install failed' });
          }
        }
      }
    } catch (e) {
      setTsStatus({ type: 'error', message: (e as Error).message });
    } finally {
      setTsInstalling(false);
    }
  };

  // Ping Tailscale health until reachable
  const pingTsHealth = async (url: string) => {
    setTsProgress('Waiting for Tailscale ready...');
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: 'no-cors', cache: 'no-store' });
        if (ping.ok || ping.type === 'opaque') return true;
      } catch { /* not ready yet */ }
    }
    return false;
  };

  // Show inline login button instead of auto-opening popup (browsers block popups
  // opened after async work because the user gesture is lost).
  const requestUserAuth = (url: string, label: string) => {
    setTsAuthUrl(url);
    setTsAuthLabel(label);
  };

  const clearUserAuth = () => {
    setTsAuthUrl('');
    setTsAuthLabel('');
  };

  const handleConnectTailscale = async () => {
    setShowTsModal(false);
    setTsConnecting(true);
    setTsLoading(true);
    setTsStatus(null);
    setTsProgress('Connecting...');
    clearUserAuth();
    try {
      const res = await fetch('/api/tunnel/tailscale-enable', { method: 'POST' });
      const data = await safeJson(res);

      if (res.ok && data.success) {
        setTsUrl((data.tunnelUrl as string) || '');
        const reachable = await pingTsHealth(data.tunnelUrl as string);
        setTsEnabled(true);
        setTsStatus(reachable ? null : { type: 'warning', message: 'Connected but not reachable yet.' });
        return;
      }

      if (data.needsLogin && data.authUrl) {
        requestUserAuth(data.authUrl as string, 'Open Login Page');
        setTsProgress('Login required — click "Open Login Page" to continue');
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const r2 = await fetch('/api/tunnel/tailscale-check');
            if (r2.ok) {
              const check = await safeJson(r2);
              if (check.loggedIn) {
                clearUserAuth();
                setTsProgress('Starting funnel...');
                const res2 = await fetch('/api/tunnel/tailscale-enable', { method: 'POST' });
                const data2 = await safeJson(res2);
                if (res2.ok && data2.success) {
                  setTsUrl((data2.tunnelUrl as string) || '');
                  const ok2 = await pingTsHealth(data2.tunnelUrl as string);
                  setTsEnabled(true);
                  setTsStatus(ok2 ? null : { type: 'warning', message: 'Connected but not reachable yet.' });
                } else if (data2.funnelNotEnabled && data2.enableUrl) {
                  await pollFunnelEnable(data2.enableUrl as string);
                } else {
                  setTsStatus({ type: 'error', message: (data2.error as string) || 'Failed to start funnel' });
                }
                return;
              }
            }
          } catch { /* retry */ }
        }
        clearUserAuth();
        setTsStatus({ type: 'error', message: 'Login timed out. Please try again.' });
        return;
      }

      if (data.funnelNotEnabled && data.enableUrl) {
        await pollFunnelEnable(data.enableUrl as string);
        return;
      }

      setTsStatus({ type: 'error', message: (data.error as string) || (res.ok ? 'Failed to connect' : `Tailscale backend unavailable (HTTP ${res.status})`) });
    } catch (error) {
      setTsStatus({ type: 'error', message: (error as Error).message });
    } finally {
      setTsLoading(false);
      setTsConnecting(false);
      setTsProgress('');
      clearUserAuth();
    }
  };

  const pollFunnelEnable = async (enableUrl: string) => {
    requestUserAuth(enableUrl, 'Open Funnel Settings');
    setTsProgress('Click "Open Funnel Settings" to enable Funnel...');
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch('/api/tunnel/tailscale-enable', { method: 'POST' });
        const data = await safeJson(res);
        if (res.ok && data.success) {
          clearUserAuth();
          setTsUrl((data.tunnelUrl as string) || '');
          const ok3 = await pingTsHealth(data.tunnelUrl as string);
          setTsEnabled(true);
          setTsStatus(ok3 ? null : { type: 'warning', message: 'Connected but not reachable yet.' });
          return;
        }
        if (data.funnelNotEnabled) continue;
        if (data.error) {
          clearUserAuth();
          setTsStatus({ type: 'error', message: data.error as string });
          return;
        }
      } catch { /* retry */ }
    }
    clearUserAuth();
    setTsStatus({ type: 'error', message: 'Timed out waiting for Funnel to be enabled.' });
  };

  const handleDisableTailscale = async () => {
    setTsLoading(true);
    setTsStatus(null);
    try {
      const res = await fetch('/api/tunnel/tailscale-disable', { method: 'POST' });
      const data = await safeJson(res);
      if (res.ok) {
        setTsEnabled(false);
        setTsUrl('');
        setShowDisableTsModal(false);
        setTsStatus({ type: 'success', message: 'Tailscale disabled' });
      } else {
        setTsStatus({ type: 'error', message: (data.error as string) || 'Failed to disable Tailscale' });
      }
    } catch (e) {
      setTsStatus({ type: 'error', message: (e as Error).message });
    } finally {
      setTsLoading(false);
    }
  };

  const handleOpenTsModal = async () => {
    setTsStatus(null);
    setTsInstallLog([]);
    const data = await checkTailscaleInstalled();
    if (data?.installed && data?.hasCachedPassword) {
      handleConnectTailscale();
    } else {
      setShowTsModal(true);
    }
  };

  // ─── API key handlers (muse /api/keys)
  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await safeJson(res);

      if (res.ok) {
        setCreatedKey(data.key as string);
        await fetchData();
        setNewKeyName('');
        setShowAddModal(false);
      }
    } catch (error) {
      console.log('Error creating key:', error);
    }
  };

  const handleDeleteKey = async (id: string) => {
    setConfirmState({
      title: 'Delete API Key',
      message: 'Delete this API key?',
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (res.ok) {
            setKeys(keys.filter((k) => k.id !== id));
            setVisibleKeys(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            setRevealedKeys(prev => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
            // access rules are stored on the key server-side — nothing to clean up
          }
        } catch (error) {
          console.log('Error deleting key:', error);
        }
      }
    });
  };

  const handleToggleKey = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch('/api/keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled: isActive }),
      });
      if (res.ok) {
        setKeys(prev => prev.map(k => k.id === id ? { ...k, isActive } : k));
      }
    } catch (error) {
      console.log('Error toggling key:', error);
    }
  };

  // Save a key's access rule — persisted on the key record, enforced by /v1/*.
  const handleUpdateKeyAccess = async (id: string, access: KeyAccess) => {
    const prevAccess = keys.find(k => k.id === id)?.access;
    setKeys(keys => keys.map(k => k.id === id ? { ...k, access } : k)); // optimistic
    try {
      const res = await fetch('/api/keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, access }),
      });
      if (!res.ok) setKeys(keys => keys.map(k => k.id === id ? { ...k, access: prevAccess } : k));
    } catch {
      setKeys(keys => keys.map(k => k.id === id ? { ...k, access: prevAccess } : k));
    }
  };

  const toggleKeyVisibility = async (keyId: string) => {
    if (visibleKeys.has(keyId)) {
      setVisibleKeys(prev => {
        const next = new Set(prev);
        next.delete(keyId);
        return next;
      });
      return;
    }
    // Fetch the full key on demand — list endpoint returns masked values
    if (!revealedKeys[keyId]) {
      try {
        const res = await fetch(`/api/keys?reveal=${encodeURIComponent(keyId)}`);
        const data = await safeJson(res);
        if (!data.key) return;
        setRevealedKeys(prev => ({ ...prev, [keyId]: data.key as string }));
      } catch { return; }
    }
    setVisibleKeys(prev => new Set(prev).add(keyId));
  };

  const revealKey = useCallback(async (keyId: string): Promise<string> => {
    if (revealedKeys[keyId]) return revealedKeys[keyId];
    const res = await fetch(`/api/keys?reveal=${encodeURIComponent(keyId)}`);
    const data = await safeJson(res);
    if (!data.key) throw new Error('Không lấy được key');
    setRevealedKeys(prev => ({ ...prev, [keyId]: data.key as string }));
    return data.key as string;
  }, [revealedKeys]);

  const handleCopyKey = async (key: EndpointKey) => {
    let full = revealedKeys[key.id];
    if (!full) {
      try {
        full = await revealKey(key.id);
      } catch { /* fall back to masked */ }
    }
    copyWithToast(full || key.key, key.id, 'API key');
  };

  const [snippetKey, setSnippetKey] = useState<EndpointKey | null>(null);

  const [baseUrl, setBaseUrl] = useState('/v1');

  // Hydration fix: Only access window on client side
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBaseUrl(`${window.location.origin}/v1`);
    }
  }, []);

  if (loading) {
    return (
      <div className="ep9r flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const currentEndpoint = baseUrl;

  return (
    <div className="ep9r flex flex-col gap-8">
      {/* Endpoint Card */}
      <Card>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">api</span>
          API Endpoint
        </h2>

        {/* Endpoint rows */}
        <div className="flex flex-col gap-2">
          {/* Local */}
          <EndpointRow
            label="Local"
            url={currentEndpoint}
            copyId="local_url"
            copied={copied}
            onCopy={copyWithToast}
          />
          {/* Cloudflare Tunnel */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
              tunnelEnabled ? 'bg-primary/10 text-primary' : 'bg-surface-2 text-text-muted'
            }`}>Tunnel</span>
            {tunnelEnabled && !tunnelLoading && tunnelReachable ? (
              <>
                <Input value={`${tunnelPublicUrl || tunnelUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
                <button
                  onClick={() => copyWithToast(`${tunnelPublicUrl || tunnelUrl}/v1`, 'tunnel_url')}
                  className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
                >
                  <span className="material-symbols-outlined text-[18px]">{copied === 'tunnel_url' ? 'check' : 'content_copy'}</span>
                </button>
                <button
                  onClick={() => setShowDisableTunnelModal(true)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Disable Tunnel"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tunnelEnabled && !tunnelLoading && !tunnelReachable ? (
              <>
                <div className={`flex-1 flex items-center gap-2 px-3 py-1.5 rounded border text-sm ${
                  tunnelTimedOut
                    ? 'border-red-300 dark:border-red-800 bg-red-500/5 text-red-600 dark:text-red-400'
                    : 'border-amber-300 dark:border-amber-800 bg-amber-500/5 text-amber-600 dark:text-amber-400'
                }`}>
                  {tunnelTimedOut ? (
                    <>
                      <span className="material-symbols-outlined text-sm">error</span>
                      <span className="min-w-0">
                        {tunnelPublicUrl || tunnelUrl
                          ? `Không kết nối được ${tunnelPublicUrl || tunnelUrl}`
                          : 'Tunnel bật nhưng thiếu public URL'}
                        <span className="opacity-70"> — kiểm tra token khớp đúng tunnel + hostname route. Đang thử lại…</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                      {tunnelEverReachable ? 'Tunnel reconnecting...' : 'Tunnel checking...'}
                    </>
                  )}
                </div>
                <button
                  onClick={() => setShowDisableTunnelModal(true)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Disable Tunnel"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tunnelLoading ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  {tunnelProgress || 'Creating tunnel...'}
                </div>
                <button
                  onClick={() => { setTunnelLoading(false); setTunnelProgress(''); }}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tunnelStatus?.type === 'error' ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
                  <span className="material-symbols-outlined text-sm">error</span>
                  {tunnelStatus.message}
                </div>
                <Button size="sm" icon="cloud_upload" onClick={() => setShowEnableTunnelModal(true)}>Enable</Button>
              </>
            ) : tunnelChecking ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  Checking...
                </div>
                <button
                  onClick={() => setTunnelChecking(false)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : (
              <Button
                size="sm"
                icon="cloud_upload"
                onClick={() => {
                  if (isLoginUnsafe) {
                    setTunnelStatus({ type: 'error', message: `Security required: ${unsafeReason}` });
                    return;
                  }
                  if (!requireApiKey) {
                    setTunnelStatus({ type: 'error', message: 'Security required: Enable "Require API key" before activating the tunnel.' });
                    return;
                  }
                  setShowEnableTunnelModal(true);
                }}
              >
                Enable
              </Button>
            )}
          </div>
          {/* Tailscale */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
              tsEnabled ? 'bg-primary/10 text-primary' : 'bg-surface-2 text-text-muted'
            }`}>Tailscale</span>
            {tsEnabled && !tsLoading && tsReachable ? (
              <>
                <Input value={`${tsUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
                <button
                  onClick={() => copyWithToast(`${tsUrl}/v1`, 'ts_url')}
                  className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
                >
                  <span className="material-symbols-outlined text-[18px]">{copied === 'ts_url' ? 'check' : 'content_copy'}</span>
                </button>
                <button
                  onClick={() => setShowDisableTsModal(true)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Disable Tailscale"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tsEnabled && !tsLoading && !tsReachable ? (
              <>
                <div className={`flex-1 flex items-center gap-2 px-3 py-1.5 rounded border text-sm ${
                  tsTimedOut
                    ? 'border-red-300 dark:border-red-800 bg-red-500/5 text-red-600 dark:text-red-400'
                    : 'border-amber-300 dark:border-amber-800 bg-amber-500/5 text-amber-600 dark:text-amber-400'
                }`}>
                  {tsTimedOut ? (
                    <>
                      <span className="material-symbols-outlined text-sm">error</span>
                      <span className="min-w-0">
                        {tsUrl ? `Không kết nối được ${tsUrl}` : 'Tailscale bật nhưng thiếu URL'}
                        <span className="opacity-70"> — kiểm tra tailscaled/funnel đang chạy. Đang thử lại…</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                      {tsEverReachable ? 'Tailscale reconnecting...' : 'Tailscale checking...'}
                    </>
                  )}
                </div>
                <button
                  onClick={() => setShowDisableTsModal(true)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Disable Tailscale"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : (tsLoading || tsConnecting) ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  {tsProgress || 'Connecting...'}
                </div>
                {tsAuthUrl && (
                  <Button
                    size="sm"
                    icon="open_in_new"
                    onClick={() => window.open(tsAuthUrl, 'tailscale_auth', 'width=600,height=700,noopener,noreferrer')}
                  >
                    {tsAuthLabel || 'Open'}
                  </Button>
                )}
                <button
                  onClick={() => { setTsLoading(false); setTsConnecting(false); setTsProgress(''); clearUserAuth(); }}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tsStatus?.type === 'error' ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
                  <span className="material-symbols-outlined text-sm">error</span>
                  {tsStatus.message}
                </div>
                <Button size="sm" icon="vpn_lock" onClick={handleOpenTsModal}>Enable</Button>
              </>
            ) : (
              <Button
                size="sm"
                icon="vpn_lock"
                onClick={() => {
                  if (isLoginUnsafe) {
                    setTsStatus({ type: 'error', message: `Security required: ${unsafeReason}` });
                    return;
                  }
                  handleOpenTsModal();
                }}
                className="bg-linear-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white!"
              >
                Enable
              </Button>
            )}
          </div>
        </div>

        {/* Pre-enable security gate banner */}
        {isLoginUnsafe && !tunnelEnabled && !tsEnabled && (
          <div className="mt-4">
            <SecurityWarning
              message={unsafeReason}
              action={{ label: 'Open settings', onClick: onOpenSettings }}
            />
          </div>
        )}

        {/* Security warnings when tunnel or tailscale is active */}
        {(tunnelEnabled || tsEnabled) && (
          <div className="mt-4 flex flex-col gap-2">
            {(!requireApiKey || keys.every((k) => !k.isActive)) && (
              <SecurityWarning
                message={
                  !requireApiKey
                    ? 'Require API key is disabled — your endpoint is publicly accessible without authentication.'
                    : 'Chưa có API key nào đang bật — endpoint đang mở công khai. Tạo key trong mục API Keys bên dưới.'
                }
                action={{ label: !requireApiKey ? 'Enable' : 'Create key', href: '#require-api-key' }}
              />
            )}
            {(!requireLogin || !hasPassword) && (
              <SecurityWarning
                message={
                  !requireLogin
                    ? 'Require login is disabled — anyone can access your dashboard via tunnel.'
                    : 'Dashboard uses the default password — change it in Profile settings.'
                }
                action={{
                  label: !requireLogin ? 'Enable' : 'Change password',
                  onClick: onOpenSettings,
                }}
              />
            )}
          </div>
        )}

        {/* Tunnel dashboard access option */}
        {(tunnelEnabled || tsEnabled) && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-3">
              <Toggle
                checked={tunnelDashboardAccess}
                onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
              />
              <div className="flex items-center gap-1.5">
                <p className="font-medium text-sm">Allow dashboard access via tunnel</p>
                <HelpTooltip text="Dashboard chỉ mở từ xa bằng link mở khóa riêng (đặt cookie đăng nhập một lần). Ai không có link vẫn bị chặn — giữ link này bí mật như API key." />
              </div>
            </div>
            {tunnelDashboardAccess && dashboardToken && (tunnelPublicUrl || tsUrl) && (
              <div className="mt-2 ml-[52px] flex items-center gap-2">
                <code className="text-xs bg-surface-2 border border-border rounded px-2 py-1 text-text-muted truncate max-w-[420px]">
                  {`${(tunnelPublicUrl || tsUrl).replace(/\/v1\/?$/, '')}/?dgk=${dashboardToken}`}
                </code>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline shrink-0"
                  onClick={() => copyWithToast(`${(tunnelPublicUrl || tsUrl).replace(/\/v1\/?$/, '')}/?dgk=${dashboardToken}`, 'dgk', 'dashboard access link')}
                >
                  Copy link mở khóa
                </button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* API Keys */}
      <Card id="require-api-key">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">vpn_key</span>
            API Keys
          </h2>
          <Button icon="add" onClick={() => setShowAddModal(true)}>
            Create Key
          </Button>
        </div>

        <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
          <div>
            <p className="font-medium">Require API key</p>
            <p className="text-sm text-text-muted">
              Requests without a valid key will be rejected
            </p>
          </div>
          <Toggle
            checked={requireApiKey}
            onChange={() => handleRequireApiKey(!requireApiKey)}
          />
        </div>

        {isRemoteHost && !requireApiKey && (
          <div className="mb-4 -mt-2">
            <SecurityWarning message="Endpoint is exposed without an API key." />
          </div>
        )}

        {keys.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">vpn_key</span>
            </div>
            <p className="text-text-main font-medium mb-1">No API keys yet</p>
            <p className="text-sm text-text-muted mb-4">Create your first API key to get started</p>
            <Button icon="add" onClick={() => setShowAddModal(true)}>
              Create Key
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {keys.map((key) => (
              <div
                key={key.id}
                className={`group flex items-start justify-between gap-3 py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 ${key.isActive === false ? 'opacity-60' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{key.name}</p>
                  <div className="flex items-center gap-2 mt-1 min-w-0 flex-wrap">
                    <code className="text-xs text-text-muted font-mono break-all min-w-0">
                      {visibleKeys.has(key.id) ? (revealedKeys[key.id] || key.key) : key.key}
                    </code>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleKeyVisibility(key.id)}
                        className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
                        title={visibleKeys.has(key.id) ? 'Hide key' : 'Show key'}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {visibleKeys.has(key.id) ? 'visibility_off' : 'visibility'}
                        </span>
                      </button>
                      <button
                        onClick={() => handleCopyKey(key)}
                        className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {copied === key.id ? 'check' : 'content_copy'}
                        </span>
                      </button>
                      <button
                        onClick={() => setSnippetKey(key)}
                        className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
                        title="Client config — cURL/Python/Node snippet"
                      >
                        <span className="material-symbols-outlined text-[14px]">code</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                  </p>
                  {key.isActive === false && (
                    <p className="text-xs text-orange-500 mt-1">Paused</p>
                  )}
                  <KeyAccessControls
                    apiKey={key}
                    onChange={(access) => handleUpdateKeyAccess(key.id, access)}
                    onRequestRestrict={() => setConfirmState({
                      title: 'Restrict API Key',
                      message: `Restrict API key "${key.name}"?\n\nIt will only be able to call the combos and models you add. Until you add one, it can call nothing.`,
                      onConfirm: async () => {
                        setConfirmState(null);
                        handleUpdateKeyAccess(key.id, { restricted: true, allow: key.access?.allow || [] });
                      }
                    })}
                  />
                </div>
                <div className="flex items-center gap-2 shrink-0 pt-0.5">
                  <Toggle
                    size="sm"
                    checked={key.isActive ?? true}
                    onChange={(checked) => {
                      if (key.isActive && !checked) {
                        setConfirmState({
                          title: 'Pause API Key',
                          message: `Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`,
                          onConfirm: async () => {
                            setConfirmState(null);
                            handleToggleKey(key.id, checked);
                          }
                        });
                      } else {
                        handleToggleKey(key.id, checked);
                      }
                    }}
                    title={key.isActive ? 'Pause key' : 'Resume key'}
                  />
                  <button
                    onClick={() => handleDeleteKey(key.id)}
                    className="p-2 hover:bg-red-500/10 rounded text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Client config snippet modal */}
      <KeySnippetModal
        isOpen={!!snippetKey}
        onClose={() => setSnippetKey(null)}
        baseUrl={baseUrl}
        keyId={snippetKey?.id || ''}
        keyName={snippetKey?.name || ''}
        revealKey={revealKey}
        onCopy={copyWithToast}
        copiedId={copied}
      />

      {/* Add Key Modal */}
      <Modal
        isOpen={showAddModal}
        title="Create API Key"
        onClose={() => {
          setShowAddModal(false);
          setNewKeyName('');
        }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
          />
          <div className="flex gap-2">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>
              Create
            </Button>
            <Button
              onClick={() => {
                setShowAddModal(false);
                setNewKeyName('');
              }}
              variant="ghost"
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Created Key Modal */}
      <Modal
        isOpen={!!createdKey}
        title="API Key Created"
        onClose={() => setCreatedKey(null)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
              Save this key now!
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              Store this key securely. You can view or copy it later from the API Keys list.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={createdKey || ''}
              readOnly
              className="flex-1 font-mono text-sm"
            />
            <Button
              variant="secondary"
              icon={copied === 'created_key' ? 'check' : 'content_copy'}
              onClick={() => copyWithToast(createdKey || '', 'created_key', 'API key')}
            >
              {copied === 'created_key' ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <Button onClick={() => setCreatedKey(null)} fullWidth>
            Done
          </Button>
        </div>
      </Modal>

      {/* Enable Tunnel Modal */}
      <Modal
        isOpen={showEnableTunnelModal}
        title="Enable Tunnel"
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary">cloud_upload</span>
              <div>
                <p className="text-sm text-text-main font-medium mb-1">
                  Remote Endpoint
                </p>
                <p className="text-sm text-text-muted">
                  Expose your local Muse endpoint to the internet. No port forwarding, no static IP needed. Share endpoint URL with your team or use it in Cursor, Cline, and other AI tools from anywhere.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div key={benefit.title} className="flex flex-col items-center text-center p-3 rounded-lg bg-sidebar/50">
                <span className="material-symbols-outlined text-xl text-primary mb-1">{benefit.icon}</span>
                <p className="text-xs font-semibold">{benefit.title}</p>
                <p className="text-xs text-text-muted">{benefit.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted">
            Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.
          </p>

          {/* One-click customer path — provisions + starts a fixed per-license
              URL without ever showing a token field. */}
          {licensed === false && (
            <p className="text-xs text-text-muted">
              Kích hoạt license (tab <b>Bản quyền</b>) để được cấp URL cố định riêng tự động — hoặc dùng URL ngẫu nhiên bên dưới.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {licensed && (
              <Button
                onClick={handleProvisionAndStart}
                fullWidth
                icon="bolt"
                disabled={provisioning || tunnelLoading}
              >
                {provisioning || tunnelLoading ? 'Đang bật…' : 'Bật — URL riêng theo license'}
              </Button>
            )}
            <div className="flex gap-2">
              <Button
                onClick={() => startTunnel()}
                variant={licensed ? 'secondary' : 'primary'}
                fullWidth
                disabled={tunnelLoading}
              >
                {tunnelLoading ? 'Đang bật…' : licensed ? 'URL ngẫu nhiên' : 'Start Tunnel'}
              </Button>
              <Button onClick={() => setShowEnableTunnelModal(false)} variant="ghost" fullWidth>Cancel</Button>
            </div>
          </div>

          {/* Advanced: manual named-tunnel config — for the vendor's own
              tunnels (e.g. api-gw) or customers running their own CF account. */}
          <button
            type="button"
            onClick={() => setShowAdvTunnel(!showAdvTunnel)}
            className="text-xs text-text-muted hover:text-text-main transition-colors self-start"
          >
            {showAdvTunnel ? '▾' : '▸'} Tự cấu hình named tunnel (nâng cao)
          </button>
          {showAdvTunnel && (
            <div className="border border-border-subtle rounded-lg p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-text-main">
                  Fixed domain (named tunnel) — optional
                </p>
                <Button size="sm" variant="ghost" icon="bolt" onClick={() => void handleProvisionTunnel()} disabled={provisioning}>
                  {provisioning ? 'Đang lấy…' : 'Lấy URL theo license'}
                </Button>
              </div>
              <Input
                label="Tunnel token"
                value={namedToken}
                onChange={(e) => setNamedToken(e.target.value)}
                placeholder="eyJhIjoi…"
                hint="Zero Trust → Networks → Tunnels → your tunnel → Install connector → token."
              />
              {namedToken.trim() ? (
                <Input
                  label="Public URL"
                  value={namedPublicUrl}
                  onChange={(e) => setNamedPublicUrl(e.target.value)}
                  placeholder="https://muse.yourdomain.com"
                  hint="The public hostname you pointed at http://localhost:1412 in the tunnel's Public Hostname tab."
                />
              ) : null}
              {namedToken.trim() && !namedPublicUrl.trim() ? (
                <p className="text-xs text-yellow-600 dark:text-yellow-400">
                  Without the public URL, the dashboard can't display or verify the endpoint — paste the hostname you configured.
                </p>
              ) : null}
              <Button onClick={handleEnableTunnel} disabled={!namedToken.trim() || tunnelLoading}>
                Start Named Tunnel
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* Disable Cloudflare Tunnel Modal */}
      <Modal
        isOpen={showDisableTunnelModal}
        title="Disable Tunnel"
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">The tunnel will be disconnected. Remote access via tunnel URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTunnel} fullWidth disabled={tunnelLoading} variant="danger">
              {tunnelLoading ? 'Disabling...' : 'Disable'}
            </Button>
            <Button onClick={() => setShowDisableTunnelModal(false)} variant="ghost" fullWidth disabled={tunnelLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Tailscale Modal */}
      <Modal
        isOpen={showTsModal}
        title="Tailscale Funnel"
        onClose={() => { if (!tsInstalling) { setShowTsModal(false); setTsStatus(null); } }}
      >
        <div className="flex flex-col gap-4">
          {/* Checking state */}
          {tsInstalled === null && (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
              Checking...
            </p>
          )}

          {/* Not installed */}
          {tsInstalled === false && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">Tailscale is not installed. Install it to enable Funnel.</p>
              <div className="flex gap-2">
                <Button onClick={handleInstallTailscale} fullWidth>
                  Install Tailscale
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {/* Installing with progress log */}
          {tsInstalling && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                Installing Tailscale...
              </div>
              {tsInstallLog.length > 0 && (
                <div ref={tsLogRef} className="bg-black/5 dark:bg-white/5 rounded p-2 max-h-40 overflow-y-auto font-mono text-xs text-text-muted">
                  {tsInstallLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Installed: show Connect button */}
          {tsInstalled === true && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Tailscale installed
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleConnectTailscale()}
                  fullWidth
                >
                  Connect
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {tsStatus && <StatusAlert status={tsStatus} />}
        </div>
      </Modal>

      {/* Disable Tailscale Modal */}
      <Modal
        isOpen={showDisableTsModal}
        title="Disable Tailscale"
        onClose={() => !tsLoading && setShowDisableTsModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">Tailscale Funnel will be stopped. Remote access via Tailscale URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTailscale} fullWidth disabled={tsLoading} variant="danger">
              {tsLoading ? 'Disabling...' : 'Disable'}
            </Button>
            <Button onClick={() => setShowDisableTsModal(false)} variant="ghost" fullWidth disabled={tsLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || 'Confirm'}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}
