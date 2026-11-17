/** Navigation after login must stay on this origin, including encoded input. */
export function safeReturnPath(value: string | null, fallback = '/account'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    if (/[\\\\\u0000-\u001f]/.test(decodeURIComponent(value))) return fallback;
    const target = new URL(value, 'https://local.invalid');
    return target.origin === 'https://local.invalid' ? `${target.pathname}${target.search}${target.hash}` : fallback;
  } catch { return fallback; }
}
