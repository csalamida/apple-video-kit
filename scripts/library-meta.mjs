// Editable source of truth for the library: what each template is FOR, the spoken cues that call for it,
// worked examples, and the motion (animation library) cues. build-library.mjs renders this into library/.
// Add a template = add its entry here (title, category, preview time) + `use` + `examples`.

const CRM = { kind: 'pipeline', title: 'Active Deals', subtitle: 'Last updated: 5m ago', columns: [
  { name: 'Qualified', count: 16, cards: [{ title: 'Tech Solutions', tag: 'Qualified' }, { title: 'Globex Inc', tag: 'Qualified' }] },
  { name: 'Proposal', count: 8, cards: [{ title: 'Globex Enterprise Deal', value: '$45k', tag: 'Proposal Sent' }] },
  { name: 'Negotiation', count: 5, cards: [] }] };

export const META = {
  'glass-card': {
    title: 'Glass Card', category: 'Cards & Panels', t: 2.4, vars: { dur: 3.4 },
    desc: 'One idea at a time: eyebrow, headline with an accent word, and 2-3 supporting rows. The default talking-point graphic.',
    use: {
      when: 'Introduce a single method, step or concept while the speaker explains it. Hold 2.5-3.5 s.',
      cues: ['"method one / two / three"', '"first, second, then"', '"there are N ways"', '"let me break this down"'],
      pairs: ['chapter-pill (advance the step)', 'kinetic-subtitle', 'lower-third (first card only)'],
      avoid: 'More than 3 rows, or a live-software walkthrough: use app-window.'
    },
    examples: [
      { name: 'Steps overview', vars: { kind: 'steps', eyebrow: 'Pipeline', badge: 'Overview', titlePre: 'Add Contacts to', titleAccent: 'Acme CRM', stagger: 0.9, items: [{ icon: 'person-plus', title: '1. Add Manually', desc: 'Direct single contact creation', tag: 'Step 01', active: true }, { icon: 'table', title: '2. CSV Spreadsheet', desc: 'Bulk import database lists', tag: 'Step 02' }, { icon: 'doc', title: '3. Web Lead Form', desc: 'Automated visitor opt-ins', tag: 'Step 03' }], footer: null } },
      { name: 'Rows + callout', vars: { kind: 'rows', eyebrow: 'Method 02', badge: 'Bulk Ingestion', titlePre: 'Import a', titleAccent: 'Spreadsheet', items: [{ left: 'contacts_q4_leads.csv', right: '1,240 Rows' }, { left: 'Column Mapping', right: 'Auto-Matched (100%)', tone: 'good' }], footer: { label: 'Bulk Operations', text: 'Automated tag assignment & smart list sync' } } }
    ]
  },
  'app-window': {
    title: 'App Window', category: 'Cards & Panels', t: 2.2, vars: { at: 14.5, dur: 3.7, layout: 'rail' },
    desc: 'A macOS-style window that hosts ANY mix of panels: pipeline, table, list, stats, chat, text, terminal, image, contact. Panels are data, not code.',
    use: {
      when: 'The speaker is explaining software, a dashboard or a live record: the screen becomes the subject, the speaker drops to a PiP (camera move) or a split rail.',
      cues: ['"let me show you"', '"here\'s how"', '"in the platform / dashboard"', '"open the ..."', '"click ..."'],
      pairs: ['spotlight (point at one panel)', 'contact-card / notification-stack (events)', 'camera: speaker PiP or split rail', 'layout:"rail" puts the headline in the free left column'],
      avoid: 'A single quick fact: use glass-card. Needs a landscape speaker PiP: keep the left column for the headline rail.'
    },
    examples: [
      { name: 'CRM verification', vars: { railNote: 'Open the record and confirm every field synced.' } },
      { name: 'Metrics dashboard', vars: { title: 'Pipeline Analytics', badge: 'LIVE', eyebrow: 'This week', titlePre: 'Speed to lead,', titleAccent: 'measured', railNote: 'Reply time down, bookings up.', cols: '1.2fr 1fr', panels: [
        { kind: 'stats', title: 'Response', items: [{ label: 'Avg reply', value: '38s', sub: 'was 2h 14m', tone: 'accent' }, { label: 'Booked', value: '+318%', tone: 'good' }, { label: 'Leads', value: '1,240' }, { label: 'Show rate', value: '86%' }] },
        { kind: 'table', title: 'Latest leads', columns: ['Name', 'Source', 'Status'], rows: [['Jane Doe', 'Opt-in form', { t: 'Booked', tone: 'good' }], ['Jane Smith', 'Webinar', { t: 'Replied' }], ['Dana Cole', 'Referral', { t: 'New', tone: 'warn' }], ['Ivy Tan', 'Opt-in form', { t: 'Booked', tone: 'good' }]] }] } },
      { name: 'Workflow + terminal', vars: { title: 'Automation Builder', badge: 'RUNNING', eyebrow: 'Technical proof', titlePre: 'Every lead triggers', titleAccent: 'a workflow', railNote: 'Each step runs without anyone touching it.', cols: '1fr 1fr', panels: [
        { kind: 'list', title: 'Workflow steps', items: [{ icon: 'person-plus', title: 'Lead created', desc: 'Opt-in form submitted', tag: 'Done', tone: 'good' }, { icon: 'doc', title: 'Send SMS', desc: 'Instant text with booking link', tag: 'Done', tone: 'good' }, { icon: 'table', title: 'Qualify', desc: 'AI asks 3 questions', tag: 'Running' }] },
        { kind: 'terminal', title: 'POST /api/v1/dispatch', lines: ['$ curl -X POST /api/v1/dispatch', '{ "lead": "jane.doe", "channel": "sms" }', '200 OK  (212 ms)', '$ tail -f workflow.log', 'qualified: true  slot: 2:00 PM'] }] } },
      { name: 'Conversation + notes', vars: { title: 'Inbox', badge: 'LIVE', eyebrow: 'Conversation', titlePre: 'Replies in', titleAccent: 'seconds', railNote: 'The first reply wins the booking.', cols: '1.1fr 1fr', panels: [
        { kind: 'chat', title: 'Jane Doe', thread: [{ from: 'them', text: 'Hi! I just filled out the form.' }, { from: 'me', text: 'Welcome Jane! Want to book a quick call today?' }, { from: 'them', text: 'Yes, 2 PM works.' }, { from: 'me', text: 'Booked for 2 PM. See you then!' }] },
        { kind: 'text', eyebrow: 'Why it works', heading: 'The first reply wins', body: 'Leads contacted inside five minutes convert far more often.', bullets: ['Instant SMS', 'AI qualification', 'Calendar booking'] }] } },
      { name: 'Screen recording', vars: { title: 'Acme CRM', badge: 'LIVE', eyebrow: 'Walkthrough', titlePre: 'Your', titleAccent: 'real screen', railNote: 'Drop in a screen recording or screenshot.', cols: '1.6fr 1fr', panels: [
        { kind: 'image', src: 'assets/demo/dashboard.svg', caption: 'Active pipeline view' },
        { kind: 'list', title: 'Notice', items: [{ title: 'Stage counts', desc: 'Update in real time' }, { title: 'Auto-sync', desc: '100% matched' }] }] } }
    ]
  },
  'contact-card': {
    title: 'Contact Card', category: 'Cards & Panels', t: 2.2, vars: { dur: 3.4 },
    desc: 'One CRM record with a verified seal and field tiles.',
    use: { when: 'A single record is the proof: a contact, lead, customer or booking.', cues: ['"the contact"', '"this lead"', '"their details"', '"make sure it\'s there"'], pairs: ['notification-stack (event) then contact-card (result)', 'app-window (as a panel)'], avoid: 'Lists of records: use an app-window table or pipeline.' },
    examples: [{ name: 'Verified lead', vars: {} }, { name: 'Customer', vars: { name: 'Jane Smith', initials: 'JS', verifiedText: 'Paying customer', fields: [{ label: 'Plan', value: 'Pro, annual' }, { label: 'MRR', value: '$297', tone: 'good' }, { label: 'Since', value: 'Mar 2026' }, { label: 'Owner', value: 'John S.' }] } }]
  },
  'lower-third': {
    title: 'Lower Third', category: 'Overlays', t: 1.6, vars: { at: 0.4, dur: 4.6 }, desc: 'Speaker name plate with verified seal.',
    use: { when: 'First 4 s of the video, or whenever a new speaker appears. Once per speaker.', cues: ['video start', '"I\'m ..."', '"joining me today"'], pairs: ['kinetic-subtitle (start 1.8 s)', 'glass-card (after it exits)'], avoid: 'Repeating the same speaker later in the video.' },
    examples: [{ name: 'Host', vars: {} }, { name: 'Guest', vars: { name: 'Dana Cole', role: 'Head of Growth, Acme', initials: 'DC', side: 'right' } }]
  },
  'chapter-pill': {
    title: 'Chapter Pill', category: 'Overlays', t: 12.2, vars: { at: 0, dur: 21.92 }, desc: 'Progress pill. The schedule is data and state changes are seek-safe.',
    use: { when: 'Any video with 2+ named sections. Mount once for the whole video; the schedule moves it.', cues: ['"three ways"', '"step one / two"', 'any structure statement'], pairs: ['glass-card (one per step)'], avoid: 'Single-idea videos under ~15 s.' },
    examples: [{ name: 'Masterclass', vars: {} }, { name: '2 steps', vars: { label: 'Quick Start', steps: ['01', '02', '✓'], initialLabel: '2 Steps', schedule: [{ t: 4, step: 1, label: 'Step 01: Connect' }, { t: 9, step: 2, label: 'Step 02: Launch' }, { t: 15, step: 4, label: 'Done ✓' }] } }]
  },
  'notification-stack': {
    title: 'Notification Stack', category: 'Overlays', t: 1.4, vars: { dur: 3.4 }, desc: 'macOS / iOS stacked notification banner.',
    use: { when: 'An event happens in the story: a lead arrives, a message lands, a payment clears. Drops in with a bouncy spring.', cues: ['"incoming"', '"a notification"', '"you get a text"', '"someone books"'], pairs: ['imessage-phone (the reply)', 'contact-card (the record)'], avoid: 'Static facts: it implies something just happened.' },
    examples: [{ name: 'New lead', vars: {} }, { name: 'Payment', vars: { app: 'Stripe', context: '', lead: 'Payment received:', message: '$297.00 from Jane Smith', icon: 'money', count: 1 } }]
  },
  'spotlight': {
    title: 'Spotlight', category: 'Overlays', t: 1.4, vars: { dur: 3.4 }, desc: 'Dims everything except a target rectangle, with an accent ring.',
    use: { when: 'Point the viewer at one area of a busy screen or app-window while the speaker names it.', cues: ['"notice"', '"look at this"', '"right here"', '"this part"'], pairs: ['app-window (set x/y/w/h to a panel)'], avoid: 'Plain talking-head shots; it needs something to point at.' },
    examples: [{ name: 'Default', vars: {} }]
  },
  'kinetic-subtitle': {
    title: 'Kinetic Subtitles', category: 'Text', t: 12.6, vars: { at: 0, dur: 21.92 }, desc: 'Word-by-word subtitle capsules. Cues are data; *star* the 1-3 punch words.',
    use: { when: 'Always-on pacing for talking-head video. Highlight numbers, verbs and the thesis, never whole sentences.', cues: ['every sentence', 'punch words: numbers, "manually", "contact"'], pairs: ['any card (keep captions at the bottom, cards at the sides)'], avoid: 'Hiding captions behind a PiP; cut a cue when a graphic already shows the same words.' },
    examples: [{ name: 'Masterclass cues', vars: {} }]
  },
  'metric-counter': {
    title: 'Metric Counter', category: 'Data', t: 1.8, vars: { dur: 3.4 }, desc: 'Big tabular number that counts up.',
    use: { when: 'A number is the point of the sentence: percent, seconds, money, growth.', cues: ['"percent", "%"', '"seconds"', '"times"', '"growth", "increase"', 'any dollar amount'], pairs: ['app-window (stats panel for many numbers)'], avoid: 'More than one number at a time; use an app-window stats panel for several.' },
    examples: [{ name: 'Percent', vars: {} }, { name: 'Seconds', vars: { label: 'Average reply', sub: 'was 2h 14m', from: 120, to: 38, suffix: 's', decimals: 0 } }, { name: 'Money', vars: { label: 'Monthly revenue', sub: 'recurring', from: 0, to: 12400, prefix: '$', suffix: '', decimals: 0 } }]
  },
  'imessage-phone': {
    title: 'iMessage Phone', category: 'Devices', t: 2.4, vars: { dur: 3.4 }, desc: 'iPhone 16 Pro iMessage thread with typing indicator.',
    use: { when: 'The story is a text conversation: an auto-reply, an SMS follow-up, a booking exchange.', cues: ['"text", "SMS"', '"message", "reply"', '"the automation responds"'], pairs: ['notification-stack (the trigger)', 'glass-card with aside (phone beside a card)'], avoid: 'Email or chat apps; use an app-window chat panel.' },
    examples: [{ name: 'Auto-reply', vars: {} }]
  }
};

// The animation library: when to reach for which MOTION (camera, spring, preset). Rows render as a cheat-sheet.
export const MOTION = [
  { cue: 'Thesis, punchline, emotional emphasis', motion: 'Camera punch-in 1.15-1.25x + edge-defocus pulse', how: 'camera.js move {scale: 1.2}; never hold a tight punch-in more than 5 s without a reframe' },
  { cue: 'Explaining software, metrics or a diagram', motion: 'Speaker PiP, 16:9, on the page margin', how: 'camera.js move {win, fit:"frame", front:true} or __hfGlass.dockPiP; pair with app-window layout:"rail"' },
  { cue: 'Long UI walkthrough or a portrait speaker', motion: 'Split-stage rail (speaker left, app right)', how: '__hfGlass.splitStage: face-centred portrait crop, no re-crop while it morphs' },
  { cue: 'Conclusion, summary, call to action', motion: 'Back to full-bleed + 1.2x punch-in', how: 'camera.js move {win:"full", scale:1.2}; speaker returns to eye contact' },
  { cue: 'A card or graphic arrives', motion: 'snappy spring from the side AWAY from the face (0.6 s), exit power2.in 0.35 s', how: '__hfGlass.ease.snappy; templates with safe:true place themselves' },
  { cue: 'Something happens (event, alert)', motion: 'bouncy drop-in, 4.6% overshoot', how: '__hfGlass.ease.bouncy via notification-stack / chat bubbles' },
  { cue: 'A number is spoken', motion: 'Counter roll 1.4 s, smooth, tabular figures', how: 'metric-counter (or a stats panel)' },
  { cue: 'One word matters', motion: 'Punch word: blue + scale 1.1, once per cue', how: 'kinetic-subtitle *word*; 1-3 words per sentence' },
  { cue: 'Look at this part', motion: 'Spotlight dim 0.55 + accent ring', how: 'spotlight template over an app-window panel' },
  { cue: 'Next step in a list', motion: 'Chapter pill advances, new card replaces the old one', how: 'chapter-pill schedule + glass-card, one card at a time' },
  { cue: 'SCREEN SHARE: pointing at a control, field or button', motion: 'Zoom to the target 1.5-1.9x (spring 0.7 s); PiP tucks to 0.7x', how: 'projects/screen-share/share.js zooms: [{t, x, y, z}]; zoom OUT ({t, z:1}) before the next topic' },
  { cue: 'SCREEN SHARE: reading small text or a modal', motion: 'Zoom 2.0-2.5x, hold 2-4 s', how: 'Only for text too small at 1080p; never hold a tight zoom without cursor activity' },
  { cue: 'SCREEN SHARE: switching apps or tabs', motion: 'Back to overview (z:1) first, then the next zoom', how: 'Avoid chained zoom-to-zoom jumps; a reset in between reads as a cut' },
  { cue: 'SCREEN SHARE: speaker talks without touching the screen', motion: 'Overview, PiP at rest size (1.0x)', how: 'PiP stays bottom-left on the margin; never move it to another corner' },
  { cue: 'Breath, filler, mid-sentence pause', motion: 'No motion', how: 'Never zoom or move graphics mid-breath; trim dead air > 0.4 s instead' }
];
