'use strict';
// Windows system-tray client — spawns tray.ps1 (PowerShell NotifyIcon,
// zero binary deps) and drives it over a JSON-lines protocol on stdio.
// Events back: {"type":"click","index":N} per menu item press.

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

function send(ps, cmd) {
  try {
    if (ps && ps.stdin.writable) ps.stdin.write(`${JSON.stringify(cmd)}\n`, 'utf8');
  } catch {}
}

/**
 * @param {object} opts
 * @param {string} opts.ps1Path    absolute path to tray.ps1
 * @param {string} opts.iconPath   absolute path to .ico
 * @param {string} opts.tooltip    tray tooltip
 * @param {{title:string,enabled?:boolean}[]} opts.items
 * @param {(index:number)=>void} opts.onClick
 * @param {()=>void} [opts.onExit]
 */
function startTray({ ps1Path, iconPath, tooltip, items, onClick, onExit }) {
  const ps = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-File', ps1Path,
      '-IconPath', iconPath,
      '-Tooltip', tooltip || 'Muse Gateway',
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  );

  const rl = readline.createInterface({ input: ps.stdout });
  rl.on('line', (line) => {
    try {
      const evt = JSON.parse(line);
      if (evt.type === 'click' && onClick) onClick(evt.index);
    } catch {}
  });
  ps.stderr.on('data', () => {});
  ps.on('error', () => {});
  ps.on('exit', () => onExit && onExit());

  items.forEach((it, i) => send(ps, { action: 'add-item', index: i, title: it.title, enabled: it.enabled !== false }));

  return {
    updateItem: (i, title, enabled = true) => send(ps, { action: 'update-item', index: i, title, enabled }),
    setTooltip: (text) => send(ps, { action: 'set-tooltip', text }),
    balloon: (title, text, ms) => send(ps, { action: 'balloon', title, text, ms }),
    kill() {
      send(ps, { action: 'kill' });
      setTimeout(() => {
        try {
          if (ps && !ps.killed) ps.kill();
        } catch {}
      }, 400);
    },
    process: ps,
  };
}

module.exports = { startTray };
