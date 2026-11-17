/** Admin-module email templates. Pure string builders. */

/**
 * Staff invite — used by the first send and by "Resend invite", so a visual
 * tweak hits both. The URL is rendered inside an `<a>` styled like a code
 * box: click to follow, right-click to copy, or select the visible text.
 * Email clients run no JavaScript, so the URL itself is the affordance.
 */
function staffInviteHtml({ userName, inviterName, setPasswordUrl, brandHeaderHtml }) {
  return `
    <div style="font-family:Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;background:#EFF1EA;padding:32px;border-radius:12px">
      ${brandHeaderHtml}
      <h2 style="margin:24px 0 12px 0;color:#141414">You're invited to THROTTLEIN admin</h2>
      <p style="color:#141414;line-height:1.5">
        Hi ${userName},<br/><br/>
        ${inviterName} added you to the THROTTLEIN admin panel as an
        internal user. To activate your account, click the button below
        and choose a password. The link is valid for
        <strong>7&nbsp;days</strong>.
      </p>
      <p style="margin:28px 0">
        <a href="${setPasswordUrl}"
           style="background:#141414;color:#FFFFFF;padding:12px 24px;text-decoration:none;
                  border-radius:8px;font-weight:bold;display:inline-block">
          Set my password
        </a>
      </p>
      <p style="font-size:12px;color:#5b5b5b;margin-bottom:8px">
        Or copy this link into your browser:
      </p>
      <a href="${setPasswordUrl}"
         style="display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
                font-size:12px;color:#141414;background:#FFFFFF;border:1px solid #d4d4d4;
                border-radius:8px;padding:10px 12px;word-break:break-all;text-decoration:none;
                line-height:1.5">
        ${setPasswordUrl}
      </a>
      <hr style="border:none;border-top:1px solid #ddd;margin:24px 0"/>
      <p style="font-size:12px;color:#5b5b5b">
        Didn't expect this? You can safely ignore the email — no
        account is created until you click the link and set a password.
      </p>
    </div>`;
}

module.exports = { staffInviteHtml };
