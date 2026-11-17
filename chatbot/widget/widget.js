/*
 * Throttlein Assistant widget — a floating button and chat panel that any
 * page can embed with one script tag. Rendered inside a Shadow DOM so the
 * host page's styles and ours never collide.
 *
 *   <script src="https://assistant.throttlein.com/widget.js"></script>
 *   ThrottleinAssistant.init({ token, endpoint, audience: 'seller' | 'superadmin' })
 *
 * The open conversation is mirrored in this tab (sessionStorage); every
 * exchange is also saved to the user's chat history on the server, which the
 * History view lists and reopens. Every request carries the dashboard's own
 * bearer token.
 */
(function () {
  'use strict';
  if (window.ThrottleinAssistant) return;

  var STORAGE_KEY = 'throttlein-assistant:conversation';
  var OPEN_KEY = 'throttlein-assistant:open';
  var FULL_KEY = 'throttlein-assistant:fullscreen';
  var MAX_HISTORY = 20;   // messages sent to the model as context
  var MAX_DISPLAY = 200;  // messages kept on screen (a reopened chat can be long)
  var CONV_KEY = 'throttlein-assistant:conversation-id';
  var POS_KEY = 'throttlein-assistant:position';

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.fab{position:fixed;right:22px;bottom:22px;z-index:2147483000;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;color:#c6ff00;background:radial-gradient(circle at 30% 30%,#2a2a2a,#0d0d0d);box-shadow:0 10px 30px rgba(0,0,0,.28),0 0 0 2px rgba(198,255,0,.35);display:flex;align-items:center;justify-content:center;transition:transform .18s ease,box-shadow .18s ease}',
    '.fab:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 14px 34px rgba(0,0,0,.32),0 0 0 3px rgba(198,255,0,.55)}',
    '.fab svg{width:28px;height:28px}',
    '.fab .pulse{position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(198,255,0,.5);animation:pulse 2.4s ease-out infinite}',
    '@keyframes pulse{0%{transform:scale(.9);opacity:.9}70%{transform:scale(1.25);opacity:0}100%{opacity:0}}',
    '.fab.open .pulse{display:none}',
    '.panel{position:fixed;right:22px;bottom:92px;z-index:2147483000;width:min(400px,calc(100vw - 32px));height:min(620px,calc(100vh - 120px));background:#fff;border-radius:18px;box-shadow:0 24px 64px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;transform-origin:bottom right;animation:pop .18s ease}',
    '@keyframes pop{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}',
    '.head{display:flex;align-items:center;gap:12px;padding:14px 16px;background:linear-gradient(135deg,#111 0%,#262626 100%);color:#fff}',
    '.head .logo{width:36px;height:36px;border-radius:10px;background:#c6ff00;color:#111;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;letter-spacing:-.5px}',
    '.head .title{font-weight:600;font-size:15px;line-height:1.2}.head .sub{font-size:12px;color:#c9c9c9;margin-top:2px}',
    '.head .x,.head .new,.head .full{background:transparent;border:0;color:#bbb;cursor:pointer;font-size:20px;line-height:1;padding:4px 6px;border-radius:6px}.head .x:hover,.head .new:hover,.head .full:hover{background:rgba(255,255,255,.1);color:#fff}',
    '.head .new{margin-left:auto;font-size:13px;padding:5px 8px;white-space:nowrap;flex-shrink:0}.head .full,.head .x{flex-shrink:0}.head > div:nth-child(2){min-width:0}.head .title,.head .sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.head .new .lbl{display:none}.panel.is-full .head .new .lbl{display:inline}',
    '.head .hist-btn{background:transparent;border:0;color:#bbb;cursor:pointer;border-radius:6px;padding:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-left:auto}.head .hist-btn svg{width:17px;height:17px}.head .hist-btn:hover,.head .hist-btn.on{background:rgba(255,255,255,.12);color:#fff}',
    '.head .hist-btn + .new{margin-left:0}',
    '.hist{display:none;flex:1;overflow-y:auto;background:#f6f6f3}',
    '.panel.show-hist .hist{display:block}.panel.show-hist .msgs,.panel.show-hist .chips,.panel.show-hist .foot,.panel.show-hist .note{display:none}',
    '.hbar{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:12px 14px;background:#f6f6f3;border-bottom:1px solid #e6e6e2}',
    '.hbar .htitle{font-weight:600;font-size:14px;color:#1a1a1a;flex:1}',
    '.hbar .hback{border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:#55554f;padding:0 6px;border-radius:6px}.hbar .hback:hover{background:#ececea}',
    '.hbar .hnew{border:1px solid #111;background:#111;color:#c6ff00;border-radius:999px;padding:6px 12px;font-size:12.5px;cursor:pointer}',
    '.hlist{list-style:none;margin:0;padding:8px 10px 14px;display:flex;flex-direction:column;gap:6px}',
    '.hitem{display:flex;align-items:stretch;background:#fff;border:1px solid #e6e6e2;border-radius:12px;overflow:hidden}',
    '.hitem:hover{border-color:#cfcfca}.hitem.cur{border-color:#111;box-shadow:inset 3px 0 0 #c6ff00}',
    '.hopen{flex:1;min-width:0;text-align:left;border:0;background:transparent;padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:3px}',
    '.hopen.loading{opacity:.5}',
    '.hopen .ht{font-size:13.5px;font-weight:500;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hopen .hm{font-size:11.5px;color:#8a8a86}',
    '.hdel{border:0;border-left:1px solid #f0f0ec;background:transparent;color:#a3a39d;cursor:pointer;padding:0 12px;display:flex;align-items:center;justify-content:center;font-size:12px;white-space:nowrap}',
    '.hdel svg{width:16px;height:16px}.hdel:hover{color:#8a1c1c;background:#fdf1f1}.hdel.armed{color:#fff;background:#c0392b;font-weight:600}',
    '.hmsg{padding:28px 18px;text-align:center;color:#6b6b65;font-size:13px}',
    '.hmsg .hretry{margin-left:6px;border:1px solid #deded8;background:#fff;border-radius:8px;padding:3px 9px;cursor:pointer}',
    '.panel.is-full .hlist,.panel.is-full .hbar{padding-left:max(16px,calc((100vw - 900px) / 2));padding-right:max(16px,calc((100vw - 900px) / 2))}',
    '.fab{touch-action:none;user-select:none;-webkit-user-select:none}.fab.dragging{cursor:grabbing;transform:scale(1.06);transition:none}.fab.dragging .pulse{display:none}',
    '.head .full{display:flex;align-items:center;justify-content:center;padding:6px}.head .full svg{width:16px;height:16px}',
    /* Header icon buttons: a fixed 24x24 box (20x20 below 767px), icons centred inside. */
    '.head .hist-btn,.head .new,.head .full,.head .x{box-sizing:border-box;width:24px;height:24px;min-width:24px;padding:0;display:inline-flex;align-items:center;justify-content:center;line-height:1;flex-shrink:0}',
    '.head .hist-btn svg,.head .full svg{width:16px;height:16px}.head .new{font-size:15px}.head .x{font-size:20px}',
    '.panel.is-full .head .new{width:auto;padding:0 6px;gap:4px}',
    '@media (max-width:767px){.head .hist-btn,.head .new,.head .full,.head .x{width:20px;height:20px;min-width:20px}.head .hist-btn svg,.head .full svg{width:14px;height:14px}.head .new{font-size:13px}.head .x{font-size:17px}.panel.is-full .head .new{width:20px;padding:0}.panel.is-full .head .new .lbl{display:none}}',
    '.panel.is-full{inset:0;top:0;left:0;right:0;bottom:0;width:auto;height:auto;max-width:none;max-height:none;border-radius:0;box-shadow:none;animation:none}',
    '.panel.is-full .head{padding:14px max(16px,calc((100vw - 900px) / 2))}',
    '.panel.is-full .msgs,.panel.is-full .chips,.panel.is-full .foot,.panel.is-full .note{padding-left:max(16px,calc((100vw - 900px) / 2));padding-right:max(16px,calc((100vw - 900px) / 2))}',
    '.panel.is-full .msg{max-width:min(78%,720px)}',
    '.fab.hide{display:none}',
    '.msgs{flex:1;overflow-y:auto;padding:16px;background:#f6f6f3;display:flex;flex-direction:column;gap:10px}',
    '.msg{max-width:86%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}',
    '.msg.user{align-self:flex-end;background:#111;color:#fff;border-bottom-right-radius:4px}',
    '.msg.bot{align-self:flex-start;background:#fff;color:#1a1a1a;border:1px solid #e6e6e2;border-bottom-left-radius:4px}',
    '.msg.bot b{font-weight:600}.msg.bot code{background:#f0f0ec;padding:1px 5px;border-radius:4px;font-size:13px}',
    '.msg.wide{max-width:100%;width:100%}',
    '.tbl{margin:10px 0 8px;max-width:100%;max-height:min(60vh,440px);overflow:auto;border:1px solid #e3e3de;border-radius:10px;background:#fff;white-space:normal;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}',
    '.tbl:focus-visible{outline:2px solid #111;outline-offset:1px}',
    '.tbl table{border-collapse:separate;border-spacing:0;width:100%;table-layout:auto;font-size:13px;line-height:1.4;color:#1a1a1a}',
    '.tbl th,.tbl td{padding:9px 12px;text-align:left;vertical-align:middle;border-bottom:1px solid #eeeeea;white-space:normal;overflow-wrap:break-word}',
    '.tbl th{position:sticky;top:0;z-index:2;background:#f4f4f0;color:#55554f;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #e3e3de;white-space:nowrap}',
    '.tbl td{background:#fff}',
    '.tbl tbody tr:nth-child(even) td{background:#fbfbf9}',
    '.tbl tbody tr:hover td{background:#f4f8e8}',
    '.tbl tbody tr:last-child td{border-bottom:0}',
    '.tbl td.name{font-weight:500}',
    '.tbl th.num,.tbl td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.tbl td.code code,.tbl td.code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}',
    '.tbl td.code code{background:transparent;padding:0;color:#3d3d38}',
    '.tbl td.code{color:#3d3d38}',
    '.tbl td.status,.tbl th.status{white-space:nowrap}',
    '.tbl .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:500;background:#efefea;color:#44443f}',
    '.tbl .pill.ok{background:#e9f7d4;color:#3a6100}.tbl .pill.warn{background:#fff3d6;color:#7a5200}.tbl .pill.bad{background:#fde8e8;color:#8a1c1c}',
    '.tbl .muted{color:#b0b0aa}',
    '.tbl.kv td.label{width:34%;color:#6b6b65;font-weight:500;background:#fafaf7}',
    '.tbl::-webkit-scrollbar{height:8px;width:8px}.tbl::-webkit-scrollbar-thumb{background:#d4d4ce;border-radius:8px}.tbl::-webkit-scrollbar-track{background:transparent}',
    '.panel.is-full .msg.wide{max-width:100%}',
    '.dt{margin-top:10px;white-space:normal}',
    '.dt .tbl{margin:0;border-radius:10px 10px 0 0;max-height:min(55vh,460px);transition:opacity .15s}',
    '.dt.loading .tbl{opacity:.45;pointer-events:none}',
    '.dt .tbl td.idx,.dt .tbl th.idx{width:1%;color:#9a9a94;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.pager{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid #e3e3de;border-top:0;border-radius:0 0 10px 10px;background:#fafaf7;font-size:12.5px;color:#55554f}',
    '.pager .info b{color:#1a1a1a;font-weight:600}',
    '.pager .ctl{display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
    '.pager button{min-width:30px;height:30px;padding:0 8px;border:1px solid #deded8;background:#fff;color:#222;border-radius:8px;cursor:pointer;font-size:12.5px;font-variant-numeric:tabular-nums}',
    '.pager button:hover:not(:disabled){border-color:#111}',
    '.pager button.cur{background:#111;color:#c6ff00;border-color:#111;cursor:default}',
    '.pager button:disabled{opacity:.35;cursor:default}',
    '.pager .gap{padding:0 2px;color:#9a9a94}',
    '.pager .pg{display:none;padding:0 6px;white-space:nowrap}',
    '.dt .msgline{padding:14px;border:1px solid #e3e3de;border-radius:10px;background:#fff;font-size:13px;color:#6b6b65}',
    '.dt .msgline button{margin-left:6px;border:1px solid #deded8;background:#fff;border-radius:8px;padding:3px 9px;cursor:pointer;font-size:12px}',
    '.panel:not(.is-full) .pager .num-btn,.panel:not(.is-full) .pager .gap{display:none}.panel:not(.is-full) .pager .pg{display:inline}.panel:not(.is-full) .pager{gap:6px;padding:8px}.panel:not(.is-full) .pager .pg{padding:0 3px}',
    '@media (max-width:600px){.pager .num-btn,.pager .gap{display:none}.pager .pg{display:inline}}',
    '.panel.is-full .tbl{max-height:calc(100dvh - 260px)}',
    '@media (max-width:480px){.tbl{max-height:55vh}.tbl table{font-size:12.5px}.tbl th,.tbl td{padding:8px 10px}}',
    '.msg.err{align-self:center;background:#fde8e8;color:#8a1c1c;font-size:13px}',
    '.typing{align-self:flex-start;background:#fff;border:1px solid #e6e6e2;border-radius:14px;padding:12px 14px;display:flex;gap:5px}.typing i{width:7px;height:7px;border-radius:50%;background:#999;animation:blink 1.2s infinite}.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}',
    '@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:1}}',
    '.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px;background:#f6f6f3}',
    '.chip{border:1px solid #d9d9d4;background:#fff;color:#222;border-radius:999px;padding:6px 11px;font-size:12.5px;cursor:pointer}.chip:hover{border-color:#111}.chip.yes{background:#111;color:#c6ff00;border-color:#111}',
    '.foot{display:flex;gap:8px;padding:12px;border-top:1px solid #ececea;background:#fff}',
    'textarea{flex:1;resize:none;border:1px solid #d9d9d4;border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.4;max-height:120px;outline:none}textarea:focus{border-color:#111}',
    '.send{width:44px;height:44px;border-radius:12px;border:0;background:#111;color:#c6ff00;cursor:pointer;display:flex;align-items:center;justify-content:center;align-self:flex-end}.send:disabled{opacity:.4;cursor:default}',
    '.note{font-size:11px;color:#8a8a86;text-align:center;padding:0 12px 10px;background:#fff}',
    '@media (max-width:480px){.panel{right:8px;bottom:84px;width:calc(100vw - 16px);height:calc(100vh - 100px)}.fab{right:14px;bottom:14px}}',
  ].join('');

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/><path d="M19 15l.8 2 2.2.7-2.2.7L19 20.5l-.8-2.1-2.2-.7 2.2-.7z"/><path d="M5 16l.6 1.5 1.6.5-1.6.5L5 20l-.6-1.5-1.6-.5 1.6-.5z"/></svg>';
  var EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
  var COLLAPSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>';
  var CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>';
  var TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
  var SEND = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>';

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function inline(text) {
    return esc(text).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>');
  }
  function cells(line) {
    // Split on unescaped pipes; "\|" stays a literal pipe inside a cell.
    var t = line.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1');
    return t.split(/(?<!\\)\|/).map(function (c) { return c.replace(/\\\|/g, '|').trim(); });
  }
  function isSep(line) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line); }
  function isRow(line) { return /^\s*\|.*\|\s*$/.test(line) || (line.indexOf('|') !== -1 && cells(line).length > 1); }
  var NUM = /^[-+]?\s*(₹|Rs\.?|\$)?\s*[\d,]+(\.\d+)?\s*(%|units?|pcs|g|kg)?$/i;
  function table(head, rows) {
    var n = head.length;
    // A name containing "|" splits into extra cells: fold the surplus back into the first column.
    rows = rows.map(function (r) {
      r = r.slice();
      if (r.length > n) r = [r.slice(0, r.length - n + 1).join(' | ')].concat(r.slice(r.length - n + 1));
      while (r.length < n) r.push('');
      return r;
    });
    var kv = n === 2 && /^(field|detail|property|attribute|key|item)s?$/i.test(head[0]);
    var kinds = head.map(function (h, c) {
      if (kv) return c === 0 ? 'label' : 'text';
      var vals = rows.map(function (r) { return r[c].replace(/`/g, ''); }).filter(function (v) { return v && v !== '—' && v !== '-'; });
      if (vals.length && vals.every(function (v) { return NUM.test(v); })) return 'num';
      if (/sku|code|id$/i.test(h) || (vals.length && vals.every(function (v) { return /^\S+$/.test(v) && v.length > 6; }))) return 'code';
      if (/status|state/i.test(h)) return 'status';
      return c === 0 ? 'name' : 'text';
    });
    var minW = { label: 120, name: 200, text: 140, code: 170, num: 80, status: 100 };
    var total = kinds.reduce(function (a, k) { return a + minW[k]; }, 0);
    var h = '<div class="tbl' + (kv ? ' kv' : '') + '" tabindex="0" role="region" aria-label="Table"><table style="min-width:' + total + 'px"><thead><tr>';
    head.forEach(function (c, i) { h += '<th class="' + kinds[i] + '">' + inline(c) + '</th>'; });
    h += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr>';
      r.forEach(function (v, i) {
        var cell = inline(v);
        if (kinds[i] === 'status' && v) cell = '<span class="pill ' + (/publish|active|live|deliver|paid|success|in stock/i.test(v) ? 'ok' : /draft|pending|low|process/i.test(v) ? 'warn' : /out|cancel|fail|reject|unpublish|inactive/i.test(v) ? 'bad' : '') + '">' + esc(v.replace(/[*`]/g, '')) + '</span>';
        h += '<td class="' + kinds[i] + '">' + (cell || '<span class="muted">—</span>') + '</td>';
      });
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }
  function render(md, noTables) {
    // Minimal, safe markdown: bold, inline code, bullets and pipe tables. Everything else is text.
    var lines = String(md).split('\n'), out = [], i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
        var head = cells(line), rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && isRow(lines[i]) && !isSep(lines[i])) { rows.push(cells(lines[i])); i++; }
        if (!noTables) out.push({ t: table(head, rows) });
        continue;
      }
      out.push({ s: line.replace(/^\s*[-*•]\s+(.*)$/, '\u0000$1') });
      i++;
    }
    // Join, dropping the line breaks that touch a table so the bubble does not get blank gaps.
    var html = '';
    out.forEach(function (o, k) {
      if (o.t) { html += o.t; return; }
      var text = o.s.charAt(0) === '\u0000' ? '• ' + inline(o.s.slice(1)) : inline(o.s);
      html += text;
      var next = out[k + 1];
      if (next && !next.t && !(text === '' && out[k - 1] && out[k - 1].t)) html += '\n';
    });
    return html.replace(/\n+$/, '');
  }

  var state = { token: null, endpoint: '', audience: 'seller', user: null, suggestions: [], messages: [], pending: null, open: false, full: false, pos: null, convId: null, view: 'chat', busy: false, awaiting: false, host: null, root: null, els: {} };

  function load() { try { var m = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]'); state.messages = Array.isArray(m) ? m.slice(-MAX_DISPLAY) : []; state.convId = sessionStorage.getItem(CONV_KEY) || null; state.open = sessionStorage.getItem(OPEN_KEY) === '1'; state.full = sessionStorage.getItem(FULL_KEY) === '1'; try { var ps = JSON.parse(sessionStorage.getItem(POS_KEY) || 'null'); state.pos = ps && isFinite(ps.x) && isFinite(ps.y) ? ps : null; } catch (e2) { state.pos = null; } } catch (e) { state.messages = []; } }
  function save() { try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.messages.slice(-60))); if (state.convId) sessionStorage.setItem(CONV_KEY, state.convId); else sessionStorage.removeItem(CONV_KEY); sessionStorage.setItem(OPEN_KEY, state.open ? '1' : '0'); sessionStorage.setItem(FULL_KEY, state.full ? '1' : '0'); if (state.pos) sessionStorage.setItem(POS_KEY, JSON.stringify(state.pos)); else sessionStorage.removeItem(POS_KEY); } catch (e) { /* storage unavailable */ } }

  function mount() {
    state.host = document.createElement('div');
    state.host.id = 'throttlein-assistant';
    document.body.appendChild(state.host);
    state.root = state.host.attachShadow({ mode: 'open' });
    var style = document.createElement('style'); style.textContent = CSS; state.root.appendChild(style);
    var fab = document.createElement('button'); fab.className = 'fab'; fab.type = 'button'; fab.setAttribute('aria-label', 'Open Throttlein Assistant'); fab.innerHTML = '<span class="pulse"></span>' + ICON;
    fab.addEventListener('pointerdown', startFabDrag);
    fab.addEventListener('click', function () { if (state.fabMoved) { state.fabMoved = false; return; } toggle(); });
    fab.title = 'Throttlein Assistant · drag to move';
    window.addEventListener('resize', onResize);
    state.root.appendChild(fab); state.els.fab = fab;
    applyFabPos();
    if (state.open) openPanel();
  }

  function toggle() { if (state.open) closePanel(); else openPanel(); }
  function closePanel() { state.open = false; state.full = false; save(); lockPage(false); /* closing always resets to the normal popup */ document.removeEventListener('keydown', onKey); if (state.els.panel) { state.els.panel.remove(); state.els.panel = null; } state.els.fab.classList.remove('open', 'hide'); }

  // Full-screen mode: the panel covers the viewport and the floating button hides.
  // While full screen, the page underneath must not scroll or show its scrollbar.
  var LOCK_ATTR = 'data-throttlein-assistant-lock';
  function lockPage(on) {
    var html = document.documentElement, body = document.body;
    if (on && !html.hasAttribute(LOCK_ATTR)) {
      html.setAttribute(LOCK_ATTR, JSON.stringify({ h: html.style.overflow, b: body.style.overflow }));
      html.style.overflow = 'hidden'; body.style.overflow = 'hidden';
    } else if (!on && html.hasAttribute(LOCK_ATTR)) {
      var prev = {}; try { prev = JSON.parse(html.getAttribute(LOCK_ATTR)) || {}; } catch (e) { /* ignore */ }
      html.style.overflow = prev.h || ''; body.style.overflow = prev.b || '';
      html.removeAttribute(LOCK_ATTR);
    }
  }
  function applyFull() {
    var p = state.els.panel; if (!p) return;
    p.classList.toggle('is-full', state.full);
    lockPage(state.full);
    applyPos();
    state.els.fab.classList.toggle('hide', state.full);
    var b = p.querySelector('.full');
    b.innerHTML = state.full ? COLLAPSE : EXPAND;
    b.setAttribute('aria-label', state.full ? 'Exit full screen' : 'Expand to full screen');
    b.title = state.full ? 'Exit full screen' : 'Expand to full screen';
  }
  // ---- Draggable launcher: the round button can be dragged anywhere; the popup opens beside it ----
  var FAB = 58, GAP = 12, EDGE = 8;
  function clamp(v, lo, hi) { return Math.min(Math.max(lo, v), Math.max(lo, hi)); }
  function applyFabPos() {
    var f = state.els.fab; if (!f) return;
    if (!state.pos) { f.style.left = f.style.top = f.style.right = f.style.bottom = ''; return; }
    f.style.left = clamp(state.pos.x, EDGE, window.innerWidth - FAB - EDGE) + 'px';
    f.style.top = clamp(state.pos.y, EDGE, window.innerHeight - FAB - EDGE) + 'px';
    f.style.right = 'auto'; f.style.bottom = 'auto';
  }
  function applyPos() {
    var p = state.els.panel; if (!p) return;
    if (!state.pos || state.full || window.innerWidth <= 767) { p.style.left = p.style.top = p.style.right = p.style.bottom = ''; p.style.transformOrigin = ''; return; }
    var f = state.els.fab.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
    var right = f.left + f.width / 2 > window.innerWidth / 2, below = f.top + f.height / 2 < window.innerHeight / 2;
    var x = right ? f.right - w : f.left;
    var y = below ? f.bottom + GAP : f.top - GAP - h;
    p.style.left = clamp(x, EDGE, window.innerWidth - w - EDGE) + 'px';
    p.style.top = clamp(y, EDGE, window.innerHeight - h - EDGE) + 'px';
    p.style.right = 'auto'; p.style.bottom = 'auto';
    p.style.transformOrigin = (below ? 'top ' : 'bottom ') + (right ? 'right' : 'left');
  }
  function onResize() { applyFabPos(); applyPos(); }
  function startFabDrag(e) {
    var f = state.els.fab;
    if (e.button !== undefined && e.button !== 0) return;
    var r = f.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    state.fabMoved = false;
    try { f.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    function move(ev) {
      if (!state.fabMoved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 5) return;
      state.fabMoved = true; f.classList.add('dragging');
      state.pos = { x: ev.clientX - dx, y: ev.clientY - dy };
      applyFabPos(); applyPos();
    }
    function up() {
      f.removeEventListener('pointermove', move); f.removeEventListener('pointerup', up); f.removeEventListener('pointercancel', up);
      f.classList.remove('dragging');
      if (state.fabMoved) { state.pos = { x: parseFloat(f.style.left), y: parseFloat(f.style.top) }; save(); }
    }
    f.addEventListener('pointermove', move); f.addEventListener('pointerup', up); f.addEventListener('pointercancel', up);
  }

  function toggleFull() { state.full = !state.full; save(); applyFull(); if (state.els.msgs) state.els.msgs.scrollTop = state.els.msgs.scrollHeight; }
  function onKey(e) { if (e.key === 'Escape' && state.full) toggleFull(); }

  function openPanel() {
    state.open = true; save();
    state.els.fab.classList.add('open');
    var p = document.createElement('div'); p.className = 'panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Throttlein Assistant');
    var sub = state.user ? (state.user.role === 'superadmin' ? 'Superadmin · all products' : (state.user.storeName || state.user.name || 'Your products')) : 'Product catalogue help';
    p.innerHTML = '<div class="head"><div class="logo">AI</div><div><div class="title">Throttlein Assistant</div><div class="sub">' + esc(sub) + '</div></div><button class="hist-btn" type="button" title="Chat history" aria-label="Chat history">' + CLOCK + '</button><button class="new" type="button" title="Start a new conversation">↺<span class="lbl"> New chat</span></button><button class="full" type="button"></button><button class="x" type="button" aria-label="Close">×</button></div>'
      + '<div class="hist" role="region" aria-label="Chat history"></div><div class="msgs"></div><div class="chips"></div>'
      + '<div class="foot"><textarea rows="1" placeholder="Ask about your products…" maxlength="2000"></textarea><button class="send" type="button" aria-label="Send">' + SEND + '</button></div>'
      + '<div class="note">Your seller panel only · every change is previewed and needs your confirmation</div>';
    state.root.appendChild(p); state.els.panel = p;
    state.els.msgs = p.querySelector('.msgs'); state.els.chips = p.querySelector('.chips'); state.els.input = p.querySelector('textarea'); state.els.send = p.querySelector('.send');
    p.querySelector('.x').addEventListener('click', closePanel);
    p.querySelector('.full').addEventListener('click', toggleFull);

    document.addEventListener('keydown', onKey);
    applyFull();
    p.querySelector('.new').addEventListener('click', newChat);
    p.querySelector('.hist-btn').addEventListener('click', function () { if (state.view === 'history') showChat(); else showHistory(); });
    state.els.hist = p.querySelector('.hist');
    state.els.hist.addEventListener('click', onHistoryClick);
    state.els.send.addEventListener('click', function () { submit(state.els.input.value); });
    state.els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(state.els.input.value); } });
    state.els.input.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; });
    if (!state.messages.length) {
      var hello = state.user && state.user.name ? 'Hi ' + state.user.name.split(' ')[0] + '! ' : 'Hi! ';
      addMessage('bot', hello + (state.user && state.user.role === 'superadmin'
        ? 'I can search and update products across sellers and look up any order. What would you like to do?'
        : 'I can run your seller panel with you — products, orders and shipping, returns, payouts, offers, offline sales, media and store settings. Every change is shown to you first. What would you like to do?'), false);
    }
    paint();
    if (state.view === 'history') showHistory();
    setTimeout(function () { state.els.input.focus(); }, 50);
  }

  function newChat() {
    if (state.busy) return;
    state.messages = []; state.convId = null; state.pending = null; state.awaiting = false; state.error = null; save();
    showChat();
    var hello = state.user && state.user.name ? 'Hi ' + state.user.name.split(' ')[0] + '! ' : 'Hi! ';
    addMessage('bot', hello + 'New conversation. What would you like to do with your products? You can also paste a product page URL to add it.', false);
  }

  // ---- Chat history (stored server-side per user; listed and reopened here) ----
  function api(method, path, body) {
    var headers = { Authorization: 'Bearer ' + state.token };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(state.endpoint + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { if (!r.ok || !b.ok) throw new Error((b && b.message) || 'Request failed'); return b; }); });
  }
  function when(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var now = new Date(), day = 86400000;
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (d.getTime() >= start) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    if (d.getTime() >= start - day) return 'Yesterday';
    if (d.getTime() >= start - 6 * day) return d.toLocaleDateString('en-IN', { weekday: 'short' });
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  function setView(v) {
    state.view = v;
    if (state.els.panel) state.els.panel.classList.toggle('show-hist', v === 'history');
    var b = state.els.panel && state.els.panel.querySelector('.hist-btn');
    if (b) { b.classList.toggle('on', v === 'history'); b.title = v === 'history' ? 'Back to chat' : 'Chat history'; }
  }
  function showChat() { setView('chat'); if (state.els.msgs) state.els.msgs.scrollTop = state.els.msgs.scrollHeight; }
  function histShell(inner) {
    return '<div class="hbar"><button type="button" class="hback" data-act="back" aria-label="Back to chat">‹</button><span class="htitle">Your chats</span><button type="button" class="hnew" data-act="new">+ New chat</button></div>' + inner;
  }
  function showHistory() {
    setView('history');
    var el = state.els.hist; if (!el) return;
    el.innerHTML = histShell('<div class="hmsg">Loading your chats…</div>');
    // A chat open in this tab that was never saved (e.g. from before history existed) is saved first.
    var unsaved = !state.convId && state.messages.some(function (m) { return m.role === 'user'; });
    var first = unsaved
      ? api('POST', '/conversations', { messages: state.messages.slice(-MAX_HISTORY).map(function (m) { return { role: m.role, content: m.content }; }) })
          .then(function (b) { if (b.conversation && b.conversation.id) { state.convId = b.conversation.id; save(); } }).catch(function () { /* list anyway */ })
      : Promise.resolve();
    first.then(function () { return api('GET', '/conversations'); }).then(function (b) {
      if (state.view !== 'history') return;
      var items = b.items || [];
      if (!items.length) { el.innerHTML = histShell('<div class="hmsg">No saved chats yet. Every conversation from now on is saved here automatically.</div>'); return; }
      var h = '<ul class="hlist">';
      items.forEach(function (c) {
        h += '<li class="hitem' + (c.id === state.convId ? ' cur' : '') + '"><button type="button" class="hopen" data-act="open" data-id="' + esc(c.id) + '"><span class="ht">' + esc(c.title || 'Untitled chat') + '</span><span class="hm">' + esc(when(c.updatedAt)) + (c.messageCount ? ' · ' + c.messageCount + ' messages' : '') + (c.id === state.convId ? ' · open now' : '') + '</span></button>'
          + '<button type="button" class="hdel" data-act="del" data-id="' + esc(c.id) + '" aria-label="Delete chat" title="Delete chat">' + TRASH + '</button></li>';
      });
      el.innerHTML = histShell(h + '</ul>');
    }).catch(function (e) {
      if (state.view !== 'history') return;
      el.innerHTML = histShell('<div class="hmsg">Could not load your chats. <button type="button" class="hretry" data-act="retry">Retry</button></div>');
    });
  }
  function openConversation(id) {
    if (state.busy) return;
    var el = state.els.hist;
    var row = el && el.querySelector('.hopen[data-id="' + id + '"]'); if (row) row.classList.add('loading');
    api('GET', '/conversations/' + encodeURIComponent(id)).then(function (b) {
      var c = b.conversation || {};
      state.messages = (c.messages || []).slice(-MAX_DISPLAY).map(function (m, i) {
        var out = { role: m.role, content: m.content };
        if (m.table && m.table.tool) { out.table = m.table; out.tid = 'h' + id.slice(-6) + i; }
        return out;
      });
      state.convId = c.id || id; state.pending = null; state.awaiting = false; state.error = null; state.greeting = null;
      save(); showChat(); paint();
    }).catch(function () { if (row) row.classList.remove('loading'); state.error = 'Could not open that chat.'; showChat(); paint(); });
  }
  function onHistoryClick(e) {
    var b = e.target.closest('button'); if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (act === 'back') return showChat();
    if (act === 'new') return newChat();
    if (act === 'retry') return showHistory();
    if (act === 'open') return openConversation(id);
    if (act === 'del') {
      // Two-step delete: the first click arms the button, the second deletes.
      if (!b.classList.contains('armed')) {
        var armed = state.els.hist.querySelectorAll('.hdel.armed');
        for (var i = 0; i < armed.length; i++) { armed[i].classList.remove('armed'); armed[i].innerHTML = TRASH; }
        b.classList.add('armed'); b.textContent = 'Delete?'; return;
      }
      b.disabled = true;
      api('DELETE', '/conversations/' + encodeURIComponent(id)).then(function () {
        var li = b.closest('.hitem'); if (li) li.remove();
        if (id === state.convId) { state.convId = null; state.messages = []; state.pending = null; state.awaiting = false; save(); paint(); }
        if (!state.els.hist.querySelector('.hitem')) state.els.hist.innerHTML = histShell('<div class="hmsg">No saved chats yet. Your conversations will appear here.</div>');
      }).catch(function () { b.disabled = false; b.textContent = 'Retry'; });
    }
  }

  function addMessage(role, content, persist, table) {
    var m = { role: role === 'bot' ? 'assistant' : role, content: content };
    if (table && table.tool) { m.table = { tool: table.tool, args: table.args || {}, total: table.total || 0 }; m.tid = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    if (persist !== false) { state.messages.push(m); state.messages = state.messages.slice(-MAX_DISPLAY); save(); }
    else state.greeting = m;
    paint();
  }

  function paint() {
    if (!state.els.msgs) return;
    var list = (state.greeting ? [state.greeting] : []).concat(state.messages);
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var body = m.role === 'user' ? esc(m.content) : render(m.content, Boolean(m.table));
      var dt = m.role !== 'user' && m.table && m.tid ? '<div class="dt" data-tid="' + esc(m.tid) + '"></div>' : '';
      html += '<div class="msg ' + (m.role === 'user' ? 'user' : 'bot') + (dt || body.indexOf('class="tbl') !== -1 ? ' wide' : '') + '">' + body + dt + '</div>';
    }
    if (state.error) html += '<div class="msg err">' + esc(state.error) + '</div>';
    if (state.busy) html += '<div class="typing"><i></i><i></i><i></i></div>';
    state.els.msgs.innerHTML = html;
    var dts = state.els.msgs.querySelectorAll('.dt');
    for (var d = 0; d < dts.length; d++) mountTable(dts[d], list);
    state.els.msgs.scrollTop = state.els.msgs.scrollHeight;
    var chips = '';
    if (state.awaiting && !state.busy) chips = '<button class="chip yes" data-text="Yes, apply it">✓ Yes, apply it</button><button class="chip" data-text="No, cancel that">Cancel</button>';
    else if (!state.busy && state.messages.length <= 1) chips = state.suggestions.map(function (s) { return '<button class="chip" data-text="' + esc(s) + '">' + esc(s) + '</button>'; }).join('');
    state.els.chips.innerHTML = chips;
    var buttons = state.els.chips.querySelectorAll('.chip');
    for (var j = 0; j < buttons.length; j++) buttons[j].addEventListener('click', function () { submit(this.getAttribute('data-text')); });
    state.els.send.disabled = state.busy;
  }

  // ---- Paginated list tables: rows come from POST /table, not from the model's text ----
  var PAGE_SIZE = 10;
  function money(v) { var n = Number(v); return v == null || v === '' || isNaN(n) ? '' : '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function statusClass(v) { v = String(v || ''); return /publish|active|live|deliver|paid|success|in stock/i.test(v) ? 'ok' : /draft|pending|placed|low|process|confirm/i.test(v) ? 'warn' : /out|cancel|fail|reject|unpublish|inactive|rto/i.test(v) ? 'bad' : ''; }
  function cellHtml(col, v) {
    if (v == null || v === '') return '<span class="muted">—</span>';
    if (col.kind === 'money') return esc(money(v));
    if (col.kind === 'status') return '<span class="pill ' + statusClass(v) + '">' + esc(String(v).replace(/_/g, ' ')) + '</span>';
    return esc(v);
  }
  function pageList(cur, last) {
    var out = [], i;
    if (last <= 7) { for (i = 1; i <= last; i++) out.push(i); return out; }
    out.push(1);
    if (cur > 3) out.push(0);
    for (i = Math.max(2, cur - 1); i <= Math.min(last - 1, cur + 1); i++) out.push(i);
    if (cur < last - 2) out.push(0);
    out.push(last);
    return out;
  }
  function tableHtml(t) {
    var d = t.data;
    if (t.error && !d) return '<div class="msgline">' + esc(t.error) + '<button type="button" data-act="retry">Retry</button></div>';
    if (!d) return '<div class="msgline">Loading table…</div>';
    if (!d.rows.length) return '<div class="msgline">No rows on this page.</div>';
    var kinds = { name: 'name', code: 'code', num: 'num', money: 'num', status: 'status', text: 'text' };
    var minW = { name: 220, code: 170, num: 80, money: 100, status: 110, text: 140 };
    var w = 44 + d.columns.reduce(function (a, c) { return a + (minW[c.kind] || 140); }, 0);
    var first = (d.page - 1) * d.pageSize;
    var h = '<div class="tbl" tabindex="0" role="region" aria-label="Results table"><table style="min-width:' + w + 'px"><thead><tr><th class="idx">#</th>';
    d.columns.forEach(function (c) { h += '<th class="' + kinds[c.kind] + '">' + esc(c.label) + '</th>'; });
    h += '</tr></thead><tbody>';
    d.rows.forEach(function (r, i) {
      h += '<tr><td class="idx">' + (first + i + 1) + '</td>';
      d.columns.forEach(function (c) { h += '<td class="' + kinds[c.kind] + '">' + cellHtml(c, r[c.key]) + '</td>'; });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    var last = Math.max(1, Math.ceil(d.total / d.pageSize));
    var from = d.total ? first + 1 : 0, to = Math.min(d.total, first + d.rows.length);
    h += '<div class="pager"><span class="info"><b>' + from + '–' + to + '</b> of <b>' + d.total.toLocaleString('en-IN') + '</b></span><span class="ctl">';
    // « and » jump two pages at a time (clamped to the first/last page); ‹ and › move one.
    var back2 = Math.max(1, d.page - 2), fwd2 = Math.min(last, d.page + 2);
    h += '<button type="button" data-page="' + back2 + '" aria-label="Back 2 pages" title="Back 2 pages" ' + (d.page <= 1 ? 'disabled' : '') + '>«</button>';
    h += '<button type="button" data-page="' + (d.page - 1) + '" aria-label="Previous page" ' + (d.page <= 1 ? 'disabled' : '') + '>‹</button>';
    pageList(d.page, last).forEach(function (n) {
      h += n === 0 ? '<span class="gap">…</span>' : '<button type="button" class="num-btn' + (n === d.page ? ' cur' : '') + '" data-page="' + n + '"' + (n === d.page ? ' aria-current="page"' : '') + '>' + n + '</button>';
    });
    h += '<span class="pg">Page ' + d.page + ' / ' + last + '</span>';
    h += '<button type="button" data-page="' + (d.page + 1) + '" aria-label="Next page" ' + (d.page >= last ? 'disabled' : '') + '>›</button>';
    h += '<button type="button" data-page="' + fwd2 + '" aria-label="Forward 2 pages" title="Forward 2 pages" ' + (d.page >= last ? 'disabled' : '') + '>»</button>';
    return h + '</span></div>';
  }
  function paintTable(el, t) {
    el.classList.toggle('loading', Boolean(t.loading && t.data));
    el.innerHTML = tableHtml(t);
  }
  function loadPage(el, m, page, size) {
    var t = state.tables[m.tid];
    t.loading = true; t.error = null; paintTable(el, t);
    var req = ++t.req;
    fetch(state.endpoint + '/table', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
      body: JSON.stringify({ tool: m.table.tool, args: m.table.args, page: page, pageSize: size }),
    }).then(function (r) { return r.json(); }).then(function (b) {
      if (req !== t.req) return;
      t.loading = false;
      if (!b || !b.ok) { t.error = (b && b.message) || 'Could not load this table.'; }
      else { var firstLoad = !t.data; t.data = b; t.page = b.page; t.size = b.pageSize; }
      var live = state.els.msgs && state.els.msgs.querySelector('.dt[data-tid="' + m.tid + '"]');
      if (live) paintTable(live, t);
      // A fresh reply's table arrives after the chat scrolled; bring its pager into view.
      var latest = state.messages[state.messages.length - 1];
      if (firstLoad && live && latest && latest.tid === m.tid) state.els.msgs.scrollTop = state.els.msgs.scrollHeight;
    }).catch(function () {
      if (req !== t.req) return;
      t.loading = false; t.error = 'Could not load this table. Check your connection.';
      var live = state.els.msgs && state.els.msgs.querySelector('.dt[data-tid="' + m.tid + '"]');
      if (live) paintTable(live, t);
    });
  }
  function mountTable(el, list) {
    var tid = el.getAttribute('data-tid'), m = null;
    for (var i = 0; i < list.length; i++) if (list[i].tid === tid) m = list[i];
    if (!m) return;
    state.tables = state.tables || {};
    var t = state.tables[tid] || (state.tables[tid] = { page: 1, size: PAGE_SIZE, data: null, loading: false, error: null, req: 0 });
    paintTable(el, t);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.getAttribute('data-act') === 'retry') return loadPage(el, m, t.page, t.size);
      var pg = parseInt(b.getAttribute('data-page'), 10);
      if (pg && pg !== (t.data && t.data.page)) { loadPage(el, m, pg, t.size); var tb = el.querySelector('.tbl'); if (tb) tb.scrollTop = 0; }
    });
    if (!t.data && !t.loading) loadPage(el, m, t.page, t.size);
  }

  function submit(text) {
    text = String(text || '').trim();
    if (!text || state.busy) return;
    state.els.input.value = ''; state.els.input.style.height = 'auto';
    state.error = null;
    addMessage('user', text);
    state.busy = true; paint();
    fetch(state.endpoint + '/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
      body: JSON.stringify({ messages: state.messages.slice(-MAX_HISTORY).map(function (x) { return { role: x.role, content: x.content }; }), pending: state.pending || undefined, conversationId: state.convId || undefined }),
    }).then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
      .then(function (res) {
        state.busy = false;
        if (!res.body || !res.body.ok) { state.error = (res.body && res.body.message) || 'The assistant is unavailable right now.'; state.awaiting = false; state.pending = null; paint(); return; }
        state.awaiting = Boolean(res.body.awaitingConfirmation);
        state.pending = res.body.pending || null;
        if (res.body.conversationId) state.convId = res.body.conversationId;
        addMessage('bot', res.body.reply || '…', true, res.body.table);
        if (res.body.actions && res.body.actions.length) try { window.dispatchEvent(new CustomEvent('throttlein-assistant:changed', { detail: { actions: res.body.actions } })); } catch (e) { /* ignore */ }
      })
      .catch(function () { state.busy = false; state.error = 'Could not reach the assistant. Check your connection.'; paint(); });
  }

  function init(opts) {
    opts = opts || {};
    if (!opts.token) return;
    state.token = opts.token; state.endpoint = String(opts.endpoint || '').replace(/\/+$/, ''); state.audience = opts.audience || 'seller';
    load();
    fetch(state.endpoint + '/session', { headers: { Authorization: 'Bearer ' + state.token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || !s.ok) return; // not a seller/superadmin, or the service is down: show nothing
        state.user = s.user; state.suggestions = s.suggestions || [];
        if (!state.host) mount();
      }).catch(function () { /* service unavailable: stay hidden */ });
  }

  function destroy() { lockPage(false); window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey); if (state.host) { state.host.remove(); state.host = null; state.root = null; state.els = {}; } }

  window.ThrottleinAssistant = { init: init, destroy: destroy };
})();
