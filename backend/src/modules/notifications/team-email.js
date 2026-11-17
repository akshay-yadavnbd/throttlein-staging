/** Shared chrome for internal (team) email, so it reads as distinct from customer mail. Pure. */

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** @param {{ heading: string, intro?: string, rows?: Array<{ label: string, value: any }>, ctaUrl?: string, ctaLabel?: string }} content */
function teamEmailHtml({ heading, intro, rows = [], ctaUrl, ctaLabel }) {
  const rowsHtml = rows
    .filter((r) => r && r.value !== undefined && r.value !== null && r.value !== '')
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 16px 6px 0;color:#6b6b73;font-size:13px;white-space:nowrap">${esc(r.label)}</td>
        <td style="padding:6px 0;color:#141414;font-size:13px;font-weight:600">${esc(r.value)}</td>
      </tr>`,
    )
    .join('');

  return `
  <div style="font-family:Segoe UI,Roboto,sans-serif;max-width:640px;margin:auto;background:#f5f5f2;padding:28px;border-radius:12px">
    <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8a8a92;font-weight:700">
      THROTTLEIN · internal notification
    </div>
    <h2 style="margin:10px 0 6px;color:#141414;font-size:19px">${esc(heading)}</h2>
    ${intro ? `<p style="color:#3f3f44;line-height:1.55;margin:0 0 14px;font-size:14px">${esc(intro)}</p>` : ''}
    ${rowsHtml ? `<table style="border-collapse:collapse;margin:8px 0 16px">${rowsHtml}</table>` : ''}
    ${
      ctaUrl
        ? `<a href="${esc(ctaUrl)}" style="display:inline-block;background:#141414;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600">${esc(ctaLabel || 'Open in dashboard')}</a>`
        : ''
    }
    <p style="color:#9a9aa2;font-size:11px;margin:20px 0 0;line-height:1.5">
      You receive this because your address is listed under Notifications in the
      super-admin panel. Remove it there to stop these.
    </p>
  </div>`;
}

module.exports = { teamEmailHtml };
