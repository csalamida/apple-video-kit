// Director rules for scripts/cue-plan.mjs: "when the speaker says X, the edit does Y".
// Each rule is data. Add a rule = add an object; cue-plan.mjs needs no changes.
//
//   id        unique name (shows in --json)
//   match     RegExp tested against the cue text (case-insensitive unless you say otherwise)
//   suggest   template id (compositions/tpl/<id>.html) | screen move ('callout' | 'zoom' | 'focus' | 'redact')
//             | camera move ('punch-in' | 'cam-full' | 'cam-pip' | 'app-pip')
//   kind      'template' | 'screen' | 'camera' | 'transition'
//   why       the director's reason, printed in the plan
//   priority  0-100. When two ideas land within the density window, the higher one wins. PRIVACY = 100.
//   modes     ['screen'] | ['talking'] | both (default)
//   when      optional (cue, ctx) => boolean, ctx = { total, index, count }: position rules (intro / outro)
//   vars      optional (cue, match) => ({...}) starting values for the template / move
//   privacy   true = always kept, never thinned out, flagged in the plan
//
// Order does not matter: priority decides. Keep `why` short and concrete; it is what the editor reads.

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s) => String(s || '').replace(/["“”]/g, '').replace(/[.,!?;:]+$/, '').trim();
// "click the Save button in the sidebar" -> "Save button"
const object = (s, words = 3) => clean(s).replace(/^(on|the|a|an|your|this|that)\s+/i, '').replace(/^(the|a|an)\s+/i, '')
  .split(/\s+(?:in|on|at|from|to|and|then|so|which|button\b)\b/i)[0].split(/\s+/).slice(0, words).join(' ');

const MODS = { cmd: '⌘', command: '⌘', ctrl: 'Ctrl', control: 'Ctrl', option: '⌥', opt: '⌥', alt: 'Alt', shift: '⇧', enter: '↵', return: '↵', escape: 'Esc', esc: 'Esc', tab: 'Tab', space: 'Space', delete: '⌫', backspace: '⌫' };

// the control after a verb: skips keys (handled by shortcut-keys) and grabs up to 4 words
const CONTROL = String.raw`(?:on\s+)?(?:the\s+)?(?!(?:cmd|command|ctrl|control|option|opt|alt|shift|enter|return|escape|esc|tab|space|delete|backspace)\b)(["“]?\w[\w'-]*(?:\s[\w'-]+){0,3})`;
const verb = (v) => cap(v.toLowerCase().replace(/ing$/, '').replace(/^toggle.*/, 'toggle'));

const intro = (cue, ctx) => cue.start < 15;
const outro = (cue, ctx) => cue.start >= Math.min(ctx.total - 15, ctx.total * 0.85);

export const RULES = [
  // ---------- PRIVACY: always first, never thinned out ----------
  {
    id: 'privacy-secret', priority: 100, privacy: true, kind: 'screen', suggest: 'redact',
    match: /\b(api[\s-]?keys?|secret(?: key)?|access token|tokens?|passwords?|passcode|2fa code|recovery code|credit card|card number|account number|social security|ssn)\b/i,
    why: 'PRIVACY: a secret is on screen here. Blur it for the whole shot, then re-check the frame.',
    vars: (cue, m) => ({ style: 'blur', what: m[1].toLowerCase() })
  },
  {
    id: 'privacy-contact', priority: 100, privacy: true, kind: 'screen', suggest: 'redact',
    match: /(\b[\w.+-]+@[\w-]+\.[\w.]+\b|\b(e-?mail(?: address)?|phone number|home address|mobile number)\b|\+?\d[\d\s().-]{8,}\d)/i,
    why: 'PRIVACY: an email / phone number may be visible. Blur it unless it is a fake demo value.',
    vars: (cue, m) => ({ style: 'blur', what: clean(m[0]).toLowerCase() })
  },

  // ---------- Open and close ----------
  {
    id: 'intro-title', priority: 90, kind: 'template', suggest: 'title-card', when: intro,
    match: /\b(welcome|in this video|in today's video|today (?:i'm|we're|i'll|we'll|i will|we will)|let's (?:get )?start(?:ed)?|i'm going to show you)\b/i,
    why: 'Opening line: a title card names the video in the first seconds.',
    vars: (cue) => ({ mode: 'intro', eyebrow: 'Tutorial', title: titleFrom(cue.text), subtitle: '' })
  },
  {
    id: 'outro-title', priority: 90, kind: 'template', suggest: 'title-card', when: outro,
    match: /\b(see you|next (?:video|one|time)|thanks? (?:you )?for watching|that's (?:it|all) for|subscribe)\b/i,
    why: 'Sign-off: outro card while the speaker says goodbye.',
    vars: () => ({ mode: 'outro', eyebrow: 'Thanks for watching', title: 'TODO next video title', cta: 'TODO call to action' })
  },
  {
    id: 'outro-cam', priority: 90, kind: 'camera', suggest: 'cam-full', when: outro,
    match: /\b(see you|next (?:video|one|time)|thanks? (?:you )?for watching|that's (?:it|all) for|subscribe|to recap|in summary)\b/i,
    why: 'Wrap-up goes back to the face: full frame, eye contact.',
    vars: () => ({ scale: 1.2 })
  },
  {
    id: 'intro-name', priority: 85, kind: 'template', suggest: 'lower-third', when: intro,
    match: /\b(?:i'm|my name is|i am)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/,
    why: 'Speaker introduces themself: name plate, once.',
    vars: (cue, m) => ({ name: m[1], role: 'TODO role' })
  },

  // ---------- Structure ----------
  {
    id: 'overview-count', priority: 75, kind: 'template', suggest: 'checklist',
    match: /\b(?:there are|here are|we'll cover|in) (two|three|four|five|six|\d) (steps|ways|things|methods|tips|reasons|parts|stages)\b/i,
    why: 'Speaker announces the structure: show the list once so viewers know the map.',
    vars: (cue, m) => ({ eyebrow: 'Overview', title: cap(`${m[1]} ${m[2]}`) })
  },
  {
    id: 'step-marker', priority: 55, kind: 'template', suggest: 'chapter-pill',
    match: /\b(step (?:one|two|three|four|five|six|\d+)|first(?:ly)?,|second(?:ly)?,|third(?:ly)?,|finally,|number (?:one|two|three|four|five))/i,
    why: 'New step starts: advance the chapter pill (one pill for the whole video, its schedule moves).',
    vars: (cue, m) => ({ label: stepLabel(cue.text, m) })
  },
  {
    id: 'recap', priority: 75, kind: 'template', suggest: 'checklist',
    match: /\b(to recap|in summary|to sum (?:it )?up|so that's|quick recap|let's recap|to summari[sz]e|in short)\b/i,
    why: 'Recap line: tick the steps off as a checklist.',
    vars: () => ({ eyebrow: 'Recap', title: 'What we covered' })
  },
  {
    id: 'chapter-transition', priority: 50, kind: 'transition', suggest: 'transition',
    match: /\b(now let's|moving on|next up|let's move on|next, let's|okay,? (?:so )?now|all ?right,? now|let's (?:jump|switch|go) (?:in)?to)\b/i,
    why: 'Topic change: a short chapter transition resets attention (and the screen zooms back out).',
    vars: (cue, m) => ({ kind: 'chapter', eyebrow: 'Next', title: titleFrom(cue.text.slice(m.index + m[0].length)) })
  },

  // ---------- Screen share: pointing at things ----------
  {
    id: 'shortcut-keys', priority: 80, kind: 'template', suggest: 'keys',
    match: /\b(?:press(?:ing)?|hit|use|type)?\s*((?:cmd|command|ctrl|control|option|opt|alt|shift)(?:\s*(?:\+|plus|-)?\s*(?:cmd|command|ctrl|control|option|opt|alt|shift))*\s*(?:\+|plus|-)?\s*(?:[a-z0-9]\b|enter|return|tab|space|delete)|(?:press|hit)\s+(?:the\s+)?(?:enter|return|escape|esc|tab|space(?:bar)?|delete|backspace)\b(?: key)?)|\b(keyboard shortcut|shortcut|hotkey)\b/i,
    why: 'Keyboard shortcut spoken: show the keys, viewers cannot see a key press.',
    vars: (cue, m) => ({ keys: parseKeys(m[1] || ''), label: keysLabel(cue.text.slice(m.index + m[0].length)) })
  },
  {
    id: 'click-callout', priority: 70, kind: 'screen', suggest: 'callout', modes: ['screen'],
    match: new RegExp(String.raw`(?<!\bto )\b(click(?:ing)?|press|tap|select|choose|hit|toggle(?: on| off)?|check|uncheck)\s+` + CONTROL, 'i'),
    why: 'Speaker names a control: ring + label on it, and zoom in so it is readable.',
    vars: (cue, m) => ({ label: verb(m[1]) + ' ' + object(m[2]) })
  },
  {
    id: 'open-callout', priority: 62, kind: 'screen', suggest: 'callout', modes: ['screen'],
    match: new RegExp(String.raw`(?<!\bto )\b(open|go to|head to|navigate to)\s+` + CONTROL, 'i'),
    why: 'Speaker opens a page or panel: ring + label where to click (weaker than an explicit "click").',
    vars: (cue, m) => ({ label: verb(m[1]) + ' ' + object(m[2]) })
  },
  {
    id: 'small-ui-zoom', priority: 60, kind: 'screen', suggest: 'zoom', modes: ['screen'],
    match: /\b(button|field|menu|dropdown|drop-down|tab|icon|checkbox|input|toggle|sidebar|modal|dialog|badge|search bar|text box|zoom in)\b/i,
    why: 'Small UI element: zoom 1.6-1.9x so it reads at 1080p.',
    vars: (cue, m) => ({ z: /badge|icon|checkbox/i.test(m[1]) ? 1.9 : 1.7, what: m[1].toLowerCase() })
  },
  {
    id: 'look-focus', priority: 65, kind: 'screen', suggest: 'focus', modes: ['screen'],
    match: /\b(look at|notice|this (?:section|part|area|panel|column|row|chart)|right here|over here|see how|pay attention to|take a look)\b/i,
    why: 'Speaker directs the eye: dim everything except that region.',
    vars: () => ({ dim: 0.55 })
  },
  {
    id: 'look-spotlight', priority: 55, kind: 'template', suggest: 'spotlight', modes: ['talking'],
    match: /\b(look at|notice|this (?:section|part|area|panel|column|row|chart)|right here|see how|pay attention to)\b/i,
    why: 'Point at one panel of the on-screen app window.',
    vars: () => ({ x: 600, y: 300, w: 600, h: 300 })
  },
  {
    id: 'wait-fast-forward', priority: 70, kind: 'template', suggest: 'fast-forward',
    match: /\b(wait(?:ing)? for (?:it|this|that)|wait a (?:second|moment|minute)|loading|this (?:takes|will take|might take|can take) a (?:second|moment|minute|while|few)|processing|uploading|syncing|give it a (?:second|moment|minute)|let (?:it|that) (?:load|run|finish))\b/i,
    why: 'Dead time on screen: speed it up with a fast-forward badge instead of making viewers wait.',
    vars: () => ({ label: '4×', caption: 'Fast-forward' })
  },
  {
    id: 'demo-cam-pip', priority: 60, kind: 'camera', suggest: 'cam-pip', modes: ['screen'],
    match: /\b(let me show you|let's (?:go|jump|dive) (?:in|into)|over (?:to|on) (?:the|my) screen|here's (?:the|my) (?:screen|dashboard|app)|(?<!to )open (?:up )?(?:the|your) \w+)\b/i,
    why: 'The screen becomes the subject: webcam shrinks to the card.',
    vars: () => ({})
  },
  {
    id: 'aside-cam-full', priority: 55, kind: 'camera', suggest: 'cam-full', modes: ['screen'],
    match: /\b(here's the thing|the key is|remember|the secret is|the trick is|most important(?:ly)?|bottom line|honestly)\b/i,
    why: 'An aside to the viewer, not about the screen: go full webcam for this line.',
    vars: () => ({})
  },

  // ---------- Data and proof ----------
  {
    id: 'metric', priority: 65, kind: 'template', suggest: 'metric-counter',
    match: /(\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k\b|m\b|million|thousand|billion)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b|x\b|times\b|seconds?\b|minutes?\b|hours?\b|days?\b|users\b|customers\b|leads\b|clients\b|sign-?ups\b|orders\b|visitors\b))/i,
    why: 'A number is the point of the sentence: count it up on screen.',
    vars: (cue, m) => metricVars(m[1], cue.text)
  },
  {
    id: 'before-after', priority: 60, kind: 'template', suggest: 'before-after',
    match: /\b(before and after|before,|after we|used to|instead of|compared? (?:to|with)|versus|vs\.?|the old way|the new way)\b/i,
    why: 'A comparison: show both states side by side, not one after the other.',
    vars: () => ({ before: 'TODO before.png', after: 'TODO after.png', beforeLabel: 'Before', afterLabel: 'After' })
  },
  {
    id: 'key-quote', priority: 60, kind: 'template', suggest: 'quote',
    match: /\b(here's the thing|the key is|remember(?: this)?|the secret is|the trick is|most important(?:ly)?|bottom line|the rule is)\b/i,
    why: 'A takeaway line: set it as a pull quote so it sticks.',
    vars: (cue) => ({ text: quoteText(cue.text), attribution: '', role: '' })
  },
  {
    id: 'link-chip', priority: 60, kind: 'template', suggest: 'link-chip',
    match: /\b(link(?:ed)? (?:is )?(?:in|below|down)|in the description|down below|below this video|linked (?:below|in)|check out the link|(?:go to|visit) ([\w-]+\.(?:com|io|app|dev|co|org)\S*))/i,
    why: 'Speaker points to a link: show a chip so viewers know where to look.',
    vars: (cue, m) => ({ text: 'Link in the description', url: m[2] || 'TODO url' })
  },

  // ---------- Events ----------
  {
    id: 'imessage', priority: 58, kind: 'template', suggest: 'imessage-phone',
    match: /\b(text message|sms|texts? (?:you|them|back|me)|imessage|reply by text|auto-?reply)\b/i,
    why: 'A text conversation: show it on a phone.',
    vars: () => ({ contact: 'Acme', thread: [{ from: 'them', text: 'TODO incoming message' }, { from: 'me', text: 'TODO reply' }] })
  },
  {
    id: 'notification', priority: 56, kind: 'template', suggest: 'notification-stack',
    match: /\b(notifications?|you'll get (?:a|an) (?:message|email|alert|ping)|pops? up|alerts? (?:you|fires)|you get pinged|instantly notified)\b/i,
    why: 'Something happens: a notification drops in.',
    vars: () => ({ app: 'Acme', lead: 'New submission:', message: 'TODO what the alert says', time: 'now' })
  },

  // ---------- Talking head: explaining ----------
  {
    id: 'software-window', priority: 50, kind: 'template', suggest: 'app-window', modes: ['talking'],
    match: /\b(let me show you|here's how|in the (?:dashboard|app|platform|settings)|open (?:up )?the|inside (?:the )?\w+|click(?:ing)?)\b/i,
    why: 'Explaining software: the app becomes the subject, speaker drops to a PiP (camera move added).',
    vars: (cue, m) => ({ layout: 'rail', railNote: quoteText(sentenceAt(cue.text, m.index)) })
  },
  {
    id: 'concept-card', priority: 40, kind: 'template', suggest: 'glass-card', modes: ['talking'],
    match: /\b(the (?:idea|concept|reason|point|goal|problem) is|this means|which means|think of it|in other words|the way (?:it|this) works|why\? because)\b/i,
    why: 'One idea explained: a glass card holds the headline while the speaker talks.',
    vars: (cue) => ({ eyebrow: 'Key idea', titlePre: titleFrom(cue.text), titleAccent: '' })
  },
  {
    id: 'emphasis-punch', priority: 30, kind: 'camera', suggest: 'punch-in', modes: ['talking'],
    when: (cue) => cue.start >= 4,   // the opening title card owns the first seconds
    match: /(!|\b(really|never|always|every single|huge|critical|crucial|absolutely|exactly|biggest|most people)\b)/i,
    why: 'Emphatic line: punch in 1.15-1.2x for this sentence, then ease back.',
    vars: () => ({ scale: 1.18 })
  }
];

// ---------- helpers used by the vars functions ----------
function titleFrom(text) {
  const s = clean(text).replace(/^(hey|hi|hello|okay|ok|so|alright|all right)[,!]?\s*/i, '')
    .replace(/^(welcome( back)?[,!]?\s*)/i, '').replace(/^(in this video,?\s*)?(i'll|i will|we'll|we will|i'm going to|let's)\s+(show you\s+)?/i, '');
  const words = s.split(/[.!?;:]/)[0].split(/\s+/).slice(0, 9);
  while (words.length > 2 && /^(in|on|at|to|for|of|the|a|an|and|under|with|your)$/i.test(words[words.length - 1])) words.pop();
  return cap(words.join(' ').replace(/[.,!?;:]+$/, ''));
}

function keysLabel(after) {
  const s = clean(after.replace(/^\s*(?:key\s+)?(?:to\s+)?/i, '').split(/[.,;!?]/)[0]);
  return s ? cap(s.split(/\s+/).slice(0, 4).join(' ')) : '';
}

function stepLabel(text, m) {
  const rest = clean(text.slice(m.index + m[0].length).replace(/^[\s.,:—-]+(is\s+)?/i, ''));
  return rest ? cap(rest.split(/[.,:;!?]/)[0].split(/\s+/).slice(0, 4).join(' ')) : cap(clean(m[0]));
}

function sentenceAt(text, i) {
  const a = Math.max(text.lastIndexOf('. ', i), text.lastIndexOf('! ', i), text.lastIndexOf('? ', i));
  const rest = text.slice(a < 0 ? 0 : a + 2), b = rest.search(/[.!?](\s|$)/);
  return b < 0 ? rest : rest.slice(0, b + 1);
}

function quoteText(text) {
  const s = clean(text).replace(/^(here's the thing|the key is|remember( this)?|the secret is|the trick is|bottom line)[:,]?\s*/i, '');
  return cap(s.length > 90 ? s.slice(0, 87).replace(/\s+\S*$/, '') + '...' : s);
}

function parseKeys(s) {
  const parts = String(s).replace(/^(press(ing)?|hit|use|type)\s+(the\s+)?/i, '').replace(/\s+key$/i, '')
    .split(/\s*(?:\+|plus|-)\s*|\s+/).filter(Boolean);
  const keys = parts.map((p) => MODS[p.toLowerCase()] || (p === 'spacebar' ? 'Space' : p.toUpperCase()));
  return keys.length ? keys : ['TODO'];
}

function metricVars(raw, text) {
  const s = raw.toLowerCase();
  let to = Number(s.replace(/[^\d.]/g, '')) || 0, prefix = '', suffix = '', decimals = /\.\d/.test(s) ? 1 : 0;
  if (s.includes('$')) prefix = '$';
  if (/\bk\b|thousand/.test(s)) suffix = 'K'; else if (/\bm\b|million/.test(s)) suffix = 'M'; else if (/billion/.test(s)) suffix = 'B';
  if (/%|percent/.test(s)) suffix = '%';
  else if (/\bx\b|times/.test(s)) suffix = 'x';
  else if (/second/.test(s)) suffix = 's';
  else if (/minute/.test(s)) suffix = ' min';
  else if (/hour/.test(s)) suffix = ' h';
  else if (/day/.test(s)) suffix = ' days';
  else if (!prefix) suffix = ' ' + s.replace(/[\d.,\s]/g, '');
  const label = /up|increase|grew|more|extra|faster/i.test(text) ? 'Increase' : /down|less|fewer|saved|cut/i.test(text) ? 'Saved' : 'TODO label';
  return { label, from: 0, to, prefix, suffix, decimals };
}

export default RULES;
