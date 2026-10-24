// Client-safe account-name masking ("Ẩn email" toggle, 9router-style).
// Emails → keep 3 local-part chars: "harry@gmail.com" → "har***@***".
// Plain names → keep 3 chars: "Thanh Nguyen" → "Tha***".
export function maskName(name: string, enabled: boolean): string {
  if (!enabled || !name) return name;
  const at = name.indexOf('@');
  if (at > 0) return `${name.slice(0, Math.min(3, at))}***@***`;
  if (name.length <= 3) return '***';
  return `${name.slice(0, 3)}***`;
}
