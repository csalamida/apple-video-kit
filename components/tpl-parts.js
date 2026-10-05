/**
 * tpl-parts.js - small render helpers shared by templates (icons, iPhone iMessage, escaping).
 * Everything returns plain HTML strings / DOM, no globals except window.__hfParts.
 */
(function (root) {
  'use strict';
  var P = {};
  // Original 24x24 icon set (MIT, part of this kit). Line icons use stroke, solid icons use fill.
  var LINE = ' fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
  var GLYPHS = {
    'check': '<path d="M5 12.5l4.5 4.5L19 7.5"' + LINE + '/>',
    'seal': '<mask id="ic-seal-m"><rect width="24" height="24" fill="#fff"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></mask><path mask="url(#ic-seal-m)" fill="currentColor" d="M12 1.8l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 20.4l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2z"/>',
    'cellular': '<g fill="currentColor"><rect x="2" y="15" width="3.6" height="6" rx="1"/><rect x="7.4" y="11" width="3.6" height="10" rx="1"/><rect x="12.8" y="7" width="3.6" height="14" rx="1"/><rect x="18.2" y="3" width="3.6" height="18" rx="1"/></g>',
    'wifi': '<path d="M2.5 9a14 14 0 0 1 19 0M6 12.6a9 9 0 0 1 12 0M9.4 16.1a4 4 0 0 1 5.2 0"' + LINE + '/><circle cx="12" cy="19.4" r="1.7" fill="currentColor"/>',
    'battery': '<rect x="1.5" y="6.5" width="18.5" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".5"/><rect x="3.3" y="8.3" width="14.9" height="7.4" rx="1.6" fill="currentColor"/><path d="M22 10v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".5"/>',
    'chevron-left': '<path d="M15 4.5L7.5 12l7.5 7.5"' + LINE + '/>',
    'chevron-right': '<path d="M9 4.5l7.5 7.5L9 19.5"' + LINE + '/>',
    'arrow-right': '<path d="M4 12h15M13 6l6 6-6 6"' + LINE + '/>',
    'video': '<g fill="currentColor"><rect x="1.5" y="6" width="14" height="12" rx="3"/><path d="M17 10.2l4.2-2.8c.6-.4 1.3 0 1.3.7v7.8c0 .7-.7 1.1-1.3.7L17 13.8z"/></g>',
    'plus-circle': '<path fill="currentColor" fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM11 7h2v4h4v2h-4v4h-2v-4H7v-2h4z"/>',
    'arrow-up-circle': '<path fill="currentColor" fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 6.3l5.2 5.2-1.4 1.4-2.8-2.8V17.5h-2v-7.4l-2.8 2.8-1.4-1.4z"/>',
    'waveform': '<g fill="currentColor"><rect x="2" y="9" width="2.2" height="6" rx="1.1"/><rect x="6.2" y="6" width="2.2" height="12" rx="1.1"/><rect x="10.4" y="3" width="2.2" height="18" rx="1.1"/><rect x="14.6" y="7" width="2.2" height="10" rx="1.1"/><rect x="18.8" y="9.5" width="2.2" height="5" rx="1.1"/></g>',
    'person-plus': '<g fill="currentColor"><circle cx="9" cy="7.8" r="3.8"/><path d="M2 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5z"/></g><path d="M19.5 7.5v6M16.5 10.5h6"' + LINE + '/>',
    'table': '<rect x="3" y="4" width="18" height="16" rx="3"' + LINE + ' stroke-width="1.9"/><path d="M3 9.5h18M3 14.7h18M9.5 9.5V20"' + LINE + ' stroke-width="1.9"/>',
    'doc': '<path fill="currentColor" fill-rule="evenodd" d="M6.5 2h7.3l5.7 5.7V20.5A1.5 1.5 0 0 1 18 22H6.5A1.5 1.5 0 0 1 5 20.5v-17A1.5 1.5 0 0 1 6.5 2zM8 12h8v1.7H8zM8 16h8v1.7H8z"/>',
    'bolt': '<path fill="currentColor" d="M13.5 2L4.5 13.5h6L9.5 22l9-11.5h-6z"/>',
    'bell': '<g fill="currentColor"><path d="M12 2.5a6 6 0 0 0-6 6v4.2L4.3 16a1 1 0 0 0 .9 1.5h13.6a1 1 0 0 0 .9-1.5L18 12.7V8.5a6 6 0 0 0-6-6z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0z"/></g>',
    'money': '<path d="M12 2.5v19M16.5 7.3c-.8-1.3-2.5-2-4.5-2-2.5 0-4.3 1.2-4.3 3.1 0 4.4 9 2.4 9 6.8 0 1.9-2 3.1-4.7 3.1-2.1 0-3.9-.8-4.7-2.2"' + LINE + '/>',
    'chat': '<path fill="currentColor" d="M12 3c5.2 0 9.5 3.4 9.5 7.7S17.2 18.4 12 18.4c-.9 0-1.8-.1-2.6-.3L4.5 21l1.2-4.3C3.7 15.3 2.5 13.1 2.5 10.7 2.5 6.4 6.8 3 12 3z"/>',
    'mail': '<rect x="2.5" y="5" width="19" height="14" rx="3"' + LINE + ' stroke-width="1.9"/><path d="M3.5 7.5l8.5 6 8.5-6"' + LINE + ' stroke-width="1.9"/>',
    'calendar': '<rect x="3" y="4.5" width="18" height="16.5" rx="3"' + LINE + ' stroke-width="1.9"/><path d="M3 9.8h18M8 2.5v4M16 2.5v4"' + LINE + ' stroke-width="1.9"/>',
    'sparkle': '<g fill="currentColor"><path d="M11 2l1.9 6.1L19 10l-6.1 1.9L11 18l-1.9-6.1L3 10l6.1-1.9z"/><path d="M19 14.5l.8 2.2 2.2.8-2.2.8L19 20.5l-.8-2.2-2.2-.8 2.2-.8z"/></g>',
    'lock': '<rect x="4.5" y="10.5" width="15" height="11" rx="2.5" fill="currentColor"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"' + LINE + '/>',
    'link': '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"' + LINE + '/>',
    'play': '<path fill="currentColor" d="M7 4.5v15c0 .8.9 1.3 1.6.9l12-7.5c.6-.4.6-1.4 0-1.8l-12-7.5C7.9 3.2 7 3.7 7 4.5z"/>',
    'star': '<path fill="currentColor" d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5L2.5 9.3l6.6-.8z"/>',
    'chart': '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"' + LINE + '/>',
    'clock': '<circle cx="12" cy="12" r="9.2"' + LINE + ' stroke-width="1.9"/><path d="M12 7v5.2l3.4 2"' + LINE + ' stroke-width="1.9"/>',
    'eye-off': '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 8.6 4.2 9.5 7-.4 1.2-1.3 2.7-2.6 4M6.3 6.4C4.4 7.7 3 9.8 2.5 12c.9 2.8 4.5 7 9.5 7 1.7 0 3.2-.5 4.5-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"' + LINE + '/>'
  };
  var SYMBOLS = '<svg style="display:none"><defs>' + Object.keys(GLYPHS).map(function (k) {
    return '<symbol id="ic-' + k + '" viewBox="0 0 24 24">' + GLYPHS[k] + '</symbol>';
  }).join('') + '</defs></svg>';

  P.esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  // Injects the icon <defs> once per document.
  P.ensureSymbols = function () {
    if (document.getElementById('hf-ic-defs')) return;
    var d = document.createElement('div');
    d.id = 'hf-ic-defs';
    d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    d.innerHTML = SYMBOLS;
    document.body.appendChild(d);
  };

  var ALIAS = { zap: 'bolt', dollar: 'money', message: 'chat' };
  P.ICON_NAMES = Object.keys(GLYPHS);
  P.icon = function (name, size) {
    name = ALIAS[name] || name;
    if (!GLYPHS[name]) name = 'check';
    P.ensureSymbols && typeof document !== 'undefined' && document.body && P.ensureSymbols();
    return '<svg viewBox="0 0 24 24" style="width:' + (size || 20) + 'px;height:' + (size || 20) + 'px"><use href="#ic-' + name + '"/></svg>';
  };

  var TAIL = '<svg class="apple-bubble-tail %s" viewBox="0 0 10 16"><path d="M0,0 C0,7 4,14 10,15 C4,15.5 0,14 0,16 Z" fill="currentColor"/></svg>';

  /**
   * phone(cfg) -> HTML string for an iPhone 16 Pro iMessage mockup.
   * cfg: {contact, initials, back, time, thread:[{from:'them'|'me', text}], size}
   * Message elements get ids  <uid>-m<i>  and typing dots <uid>-t<i>  so phoneTimeline() can animate them.
   */
  P.phone = function (cfg, uid) {
    var th = cfg.thread || [], body = '';
    th.forEach(function (m, i) {
      if (m.from === 'me') {
        body += '<div id="' + uid + '-m' + i + '" class="apple-chat-bubble-wrap outgoing" style="opacity:0"><div class="apple-chat-bubble apple-chat-user" style="font-size:12px;padding:8px 12px">' +
          P.esc(m.text) + TAIL.replace('%s', 'outgoing') + '</div>' + (i === th.length - 1 ? '<div class="apple-chat-status" style="font-size:10px">Delivered</div>' : '') + '</div>';
      } else {
        body += '<div class="apple-chat-slot incoming" style="position:relative;align-self:flex-start;width:100%">' +
          '<div id="' + uid + '-t' + i + '" class="apple-typing-indicator" style="position:absolute;top:0;left:0;opacity:0;z-index:2"><div class="apple-typing-dot"></div><div class="apple-typing-dot"></div><div class="apple-typing-dot"></div>' + TAIL.replace('%s', 'incoming') + '</div>' +
          '<div id="' + uid + '-m' + i + '" class="apple-chat-bubble-wrap incoming" style="opacity:0"><div class="apple-chat-bubble apple-chat-incoming" style="font-size:12px;padding:8px 12px">' +
          P.esc(m.text) + TAIL.replace('%s', 'incoming') + '</div></div></div>';
      }
    });
    var u = function (id) { return '<svg viewBox="0 0 24 24"><use href="#' + id + '"/></svg>'; };
    return '<div class="apple-iphone-frame" style="height:520px;width:280px;border-radius:46px">' +
      '<div class="apple-dynamic-island"><div class="apple-dynamic-island-lens"></div></div>' +
      '<div class="apple-ios-statusbar"><span class="apple-statusbar-time">' + P.esc(cfg.time || '9:41') + '</span><div class="apple-statusbar-icons">' +
      '<svg viewBox="0 0 24 24"><use href="#ic-cellular"/></svg><svg viewBox="0 0 24 24"><use href="#ic-wifi"/></svg><svg viewBox="0 0 24 24"><use href="#ic-battery"/></svg></div></div>' +
      '<div class="apple-iphone-screen"><div class="apple-imessage-nav"><div class="apple-imessage-nav-back"><svg viewBox="0 0 24 24"><use href="#ic-chevron-left"/></svg><span style="font-size:13px;font-weight:500">' + P.esc(cfg.back || '3') + '</span></div>' +
      '<div class="apple-imessage-nav-contact"><div class="apple-imessage-nav-avatar">' + P.esc(cfg.initials || 'JS') + '</div><div class="apple-imessage-nav-name">' + P.esc(cfg.contact || 'Contact') + '<svg viewBox="0 0 24 24"><use href="#ic-chevron-right"/></svg></div></div>' +
      '<div class="apple-imessage-nav-actions"><svg viewBox="0 0 24 24"><use href="#ic-video"/></svg></div></div>' +
      '<div class="apple-chat-thread" style="padding:10px 12px;gap:8px"><div class="apple-chat-timestamp">Today ' + P.esc(cfg.time || '9:41') + ' AM</div>' + body + '</div>' +
      '<div class="apple-imessage-composer" style="padding:6px 10px"><div class="apple-composer-plus"><svg viewBox="0 0 24 24"><use href="#ic-plus-circle"/></svg></div>' +
      '<div class="apple-composer-input" style="font-size:12px;padding:4px 10px"><span>iMessage</span><svg viewBox="0 0 24 24"><use href="#ic-waveform"/></svg></div>' +
      '<div class="apple-composer-send"><svg viewBox="0 0 24 24"><use href="#ic-arrow-up-circle"/></svg></div></div>' +
      '<div class="apple-home-indicator"></div></div></div>';
  };

  // Adds the typing -> message sequence to `tl`. Message i appears at (t0 + m.at); typing shows 0.43s before.
  P.phoneTimeline = function (tl, cfg, uid, t0) {
    var E = (root.__hfGlass && root.__hfGlass.ease) || {};
    (cfg.thread || []).forEach(function (m, i) {
      var at = t0 + (m.at != null ? m.at : 0.6 + i * 0.6), sel = '#' + uid + '-m' + i;
      if (m.from !== 'me') {
        var ty = '#' + uid + '-t' + i;
        tl.fromTo(ty, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.2, ease: E.smooth }, at - 0.43);
        tl.to(ty, { opacity: 0, scale: 0.88, duration: 0.12, ease: 'power2.in' }, at - 0.03);
      }
      tl.fromTo(sel, { opacity: 0, scale: 0.9, y: 8 }, { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: E.bouncy }, at);
    });
    return tl;
  };

  /**
   * contact(cfg) -> HTML for a CRM contact record. cfg:{name, initials, verifiedText, fields:[{label,value,tone}]}
   * Field tiles get class "it" so a timeline can stagger them.
   */
  P.contact = function (cfg) {
    var f = (cfg.fields || []).map(function (x) {
      return '<div class="ct-tile it"><div class="ct-l">' + P.esc(x.label) + '</div><div class="ct-v' + (x.tone ? ' ' + x.tone : '') + '">' + P.esc(x.value) + '</div></div>';
    }).join('');
    return '<div class="ct"><div class="ct-head it"><div class="ct-av">' + P.esc(cfg.initials || '') + '</div><div><div class="ct-n">' + P.esc(cfg.name) + '</div>' +
      (cfg.verifiedText ? '<div class="ct-vf">' + P.icon('seal', 15) + P.esc(cfg.verifiedText) + '</div>' : '') + '</div></div><div class="ct-grid">' + f + '</div></div>';
  };
  P.contactCss = '.ct{display:flex;flex-direction:column;gap:calc(22px*var(--s));justify-content:center;height:100%}.ct-head{display:flex;align-items:center;gap:16px}' +
    '.ct-av{width:calc(60px*var(--s));height:calc(60px*var(--s));border-radius:50%;background:linear-gradient(135deg,#0a60d0,#2997ff);border:2px solid rgba(255,255,255,.6);display:flex;align-items:center;justify-content:center;font-size:calc(22px*var(--s));font-weight:700;flex:none}' +
    '.ct-n{font-size:calc(24px*var(--s));font-weight:700;letter-spacing:var(--track-title)}.ct-vf{display:flex;align-items:center;gap:6px;color:var(--accent-text);font-size:calc(14px*var(--s));font-weight:600;margin-top:3px}' +
    '.ct-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ct-tile{background:var(--fill-2);border:1px solid rgba(255,255,255,.12);border-radius:14px;corner-shape:var(--corner);padding:14px 16px}' +
    '.ct-l{font-size:calc(11px*var(--s));font-weight:600;text-transform:uppercase;letter-spacing:var(--track-label);color:var(--label-secondary);margin-bottom:4px}.ct-v{font-size:calc(15px*var(--s));font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ct-v.good{color:var(--green)}';

  /**
   * pipeline(cfg) -> HTML kanban for a CRM board (replaces the old JPEG). cfg:{title, columns:[{name,count,cards:[{title,tag,value}]}]}
   */
  P.pipeline = function (cfg) {
    var cols = (cfg.columns || []).map(function (c) {
      return '<div class="pl-col it"><div class="pl-ch"><span>' + P.esc(c.name) + '</span><span class="pl-n">' + P.esc(c.count) + '</span></div>' +
        (c.cards || []).map(function (k) {
          return '<div class="pl-card"><div class="pl-ct">' + P.esc(k.title) + '</div>' + (k.value ? '<div class="pl-cv">' + P.esc(k.value) + '</div>' : '') +
            (k.tag ? '<span class="pl-tag">' + P.esc(k.tag) + '</span>' : '') + '</div>';
        }).join('') + '</div>';
    }).join('');
    return '<div class="pl"><div class="pl-bar"><span class="pl-t">' + P.esc(cfg.title || 'Active Deals') + '</span><span class="pl-s">' + P.esc(cfg.subtitle || '') + '</span></div><div class="pl-cols">' + cols + '</div></div>';
  };
  P.pipelineCss = '.pl{display:flex;flex-direction:column;gap:14px;height:100%}.pl-bar{display:flex;justify-content:space-between;align-items:baseline}.pl-t{font-size:calc(17px*var(--s));font-weight:600}.pl-s{font-size:calc(13px*var(--s));color:var(--label-tertiary)}' +
    '.pl-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;flex:1}.pl-col{background:var(--fill-2);border:1px solid rgba(255,255,255,.1);border-radius:18px;corner-shape:var(--corner);padding:12px;display:flex;flex-direction:column;gap:10px}' +
    '.pl-ch{display:flex;justify-content:space-between;font-size:calc(14px*var(--s));font-weight:600}.pl-n{color:var(--label-tertiary);font-variant-numeric:tabular-nums}' +
    '.pl-card{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:12px;corner-shape:var(--corner);padding:10px 12px;display:flex;flex-direction:column;gap:4px}' +
    '.pl-ct{font-size:calc(14px*var(--s));font-weight:600}.pl-cv{font-size:calc(13px*var(--s));color:var(--label-secondary);font-variant-numeric:tabular-nums}' +
    '.pl-tag{align-self:flex-start;font-size:calc(11px*var(--s));font-weight:600;padding:2px 8px;border-radius:100px;background:var(--accent-subtle);color:#7cc2ff}';

  /**
   * PANEL REGISTRY - what can go inside an app-window (or any host that wants a content panel).
   * P.panel({kind, ...cfg}) -> HTML.  Kinds: pipeline | contact | table | list | stats | chat | text | terminal | image.
   * Every revealable child carries class "it" so the host timeline can stagger it. Add a kind = add a function here.
   */
  var PANELS = {
    pipeline: function (c) { return P.pipeline(c); },
    contact: function (c) { return P.contact(c); },
    table: function (c) {
      var cell = function (x) { return (x && typeof x === 'object') ? '<span class="tg ' + (x.tone || '') + '">' + P.esc(x.t) + '</span>' : P.esc(x); };
      return '<div class="pn-h">' + P.esc(c.title || '') + '</div><div class="tbl"><div class="tr th it">' + (c.columns || []).map(function (h) { return '<span>' + P.esc(h) + '</span>'; }).join('') + '</div>' +
        (c.rows || []).map(function (r) { return '<div class="tr it">' + r.map(function (x) { return '<span>' + cell(x) + '</span>'; }).join('') + '</div>'; }).join('') + '</div>';
    },
    list: function (c) {
      return '<div class="pn-h">' + P.esc(c.title || '') + '</div><div class="lst">' + (c.items || []).map(function (it) {
        return '<div class="li it">' + (it.icon ? '<div class="lic">' + P.icon(it.icon, 20) + '</div>' : '') + '<div class="lt"><div class="lt1">' + P.esc(it.title) + '</div>' + (it.desc ? '<div class="lt2">' + P.esc(it.desc) + '</div>' : '') + '</div>' + (it.tag ? '<span class="tg ' + (it.tone || '') + '">' + P.esc(it.tag) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    },
    stats: function (c) {
      return '<div class="pn-h">' + P.esc(c.title || '') + '</div><div class="sts">' + (c.items || []).map(function (it) {
        return '<div class="st it"><div class="sl">' + P.esc(it.label) + '</div><div class="sv ' + (it.tone || '') + '">' + P.esc(it.value) + '</div>' + (it.sub ? '<div class="ss">' + P.esc(it.sub) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
    },
    chat: function (c) {
      return '<div class="pn-h">' + P.esc(c.title || '') + '</div><div class="cht">' + (c.thread || []).map(function (m) {
        return '<div class="cb it ' + (m.from === 'me' ? 'me' : 'them') + '">' + P.esc(m.text) + '</div>';
      }).join('') + '</div>';
    },
    text: function (c) {
      return (c.eyebrow ? '<div class="pn-e it">' + P.esc(c.eyebrow) + '</div>' : '') + (c.heading ? '<div class="pn-t it">' + P.esc(c.heading) + '</div>' : '') +
        (c.body ? '<div class="pn-b it">' + P.esc(c.body) + '</div>' : '') + (c.bullets ? '<ul class="pn-u">' + c.bullets.map(function (b) { return '<li class="it">' + P.esc(b) + '</li>'; }).join('') + '</ul>' : '');
    },
    terminal: function (c) {
      return '<div class="pn-h">' + P.esc(c.title || 'Terminal') + '</div><div class="term">' + (c.lines || []).map(function (l) {
        return '<div class="tl it' + (/^\s*\$/.test(l) ? ' cmd' : /\b2\d\d\b/.test(l) ? ' ok' : '') + '">' + P.esc(l) + '</div>';
      }).join('') + '</div>';
    },
    image: function (c) {
      return '<div class="img it"><img src="' + P.esc(c.src || '') + '" alt="">' + (c.caption ? '<div class="imc">' + P.esc(c.caption) + '</div>' : '') + '</div>';
    }
  };
  P.panelKinds = Object.keys(PANELS);
  P.panel = function (c) { return (PANELS[c.kind] || PANELS.text)(c); };
  P.panelsCss = P.contactCss + P.pipelineCss +
    '.pn-h{font-size:calc(17px*var(--s));font-weight:600;margin-bottom:12px}.pn-e{font-size:calc(12px*var(--s));font-weight:600;letter-spacing:var(--track-label);text-transform:uppercase;color:var(--label-secondary);margin-bottom:8px}' +
    '.pn-t{font-size:calc(30px*var(--s));font-weight:700;letter-spacing:var(--track-display);line-height:1.1;margin-bottom:12px}.pn-b{font-size:calc(16px*var(--s));line-height:1.45;color:var(--label-secondary)}' +
    '.pn-u{list-style:none;display:flex;flex-direction:column;gap:10px;margin-top:14px}.pn-u li{font-size:calc(16px*var(--s));padding-left:18px;position:relative}.pn-u li:before{content:"";position:absolute;left:0;top:.55em;width:7px;height:7px;border-radius:50%;background:var(--accent)}' +
    '.tbl{display:flex;flex-direction:column;gap:2px}.tr{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:10px;padding:11px 12px;border-radius:10px;font-size:calc(14px*var(--s));font-variant-numeric:tabular-nums}.tr:nth-child(even){background:var(--fill-2)}' +
    '.tr.th{font-size:calc(11px*var(--s));font-weight:600;text-transform:uppercase;letter-spacing:var(--track-label);color:var(--label-tertiary)}.tr span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.tg{display:inline-block;font-size:calc(12px*var(--s));font-weight:600;padding:3px 10px;border-radius:100px;background:var(--accent-subtle);color:#7cc2ff}.tg.good{background:rgba(48,209,88,.16);color:#6ee08c}.tg.warn{background:rgba(255,214,10,.16);color:#ffd60a}.tg.bad{background:rgba(255,69,58,.16);color:#ff8a82}' +
    '.lst{display:flex;flex-direction:column;gap:10px}.li{display:flex;align-items:center;gap:14px;padding:12px 14px;background:var(--fill-2);border:1px solid rgba(255,255,255,.1);border-radius:14px;corner-shape:var(--corner)}' +
    '.lic{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#0a60d0,#2997ff);display:flex;align-items:center;justify-content:center;flex:none}.lt{flex:1;min-width:0}.lt1{font-size:calc(15px*var(--s));font-weight:600}.lt2{font-size:calc(12px*var(--s));color:var(--label-secondary);margin-top:2px}' +
    '.sts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.st{background:var(--fill-2);border:1px solid rgba(255,255,255,.1);border-radius:16px;corner-shape:var(--corner);padding:16px}' +
    '.sl{font-size:calc(11px*var(--s));font-weight:600;text-transform:uppercase;letter-spacing:var(--track-label);color:var(--label-tertiary)}.sv{font-size:calc(40px*var(--s));font-weight:700;letter-spacing:-0.03em;margin:6px 0 2px;font-variant-numeric:tabular-nums}.sv.good{color:var(--green)}.sv.accent{color:var(--accent-text)}.ss{font-size:calc(13px*var(--s));color:var(--label-secondary)}' +
    '.cht{display:flex;flex-direction:column;gap:10px}.cb{max-width:78%;padding:10px 14px;border-radius:18px;font-size:calc(15px*var(--s));line-height:1.35}.cb.them{align-self:flex-start;background:#2c2c30}.cb.me{align-self:flex-end;background:#0a84ff}' +
    '.term{font-family:var(--font-mono);background:rgba(0,0,0,.5);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:6px;height:calc(100% - 34px)}.tl{font-size:calc(13px*var(--s));color:var(--label-secondary);white-space:pre-wrap}.tl.cmd{color:#fff}.tl.ok{color:var(--green)}' +
    '.img{position:relative;height:100%;border-radius:16px;overflow:hidden;corner-shape:var(--corner)}.img img{width:100%;height:100%;object-fit:cover;display:block}.imc{position:absolute;left:14px;bottom:14px;padding:8px 14px;border-radius:100px;background:rgba(28,28,32,.7);font-size:calc(13px*var(--s));font-weight:600}';

  root.__hfParts = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : this);
