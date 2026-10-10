/* Speaker-cutout video as DATA. Edit this file; index.html only points at your two videos.
   Sources:  #orig -> your original video (voice; also what a 'blur' background blurs)
             #cut  -> the transparent cutout made by:  npm run cutout -- inputs/<your video>.mp4 [--from s --to s]
   backgrounds: first entry t:0; later ones crossfade in over `dur` (0.8 s).
       { kind: 'gradient', preset: 'aurora' | 'midnight' | 'studio' | 'graphite' | 'paper' }   or css: '...'
       { kind: 'scene', src: 'inputs/office.png', blur: 3, brightness: 0.96, tone: 'warm' }   a photoreal room matched to YOUR angle:
           npm run backdrop -- inputs/<your video>.mp4 --scene office   measures your framing and light, writes the image prompt
       { kind: 'color', color: '#0b0b0f' }   { kind: 'image', src: 'inputs/office.jpg', blur: 0 }
       { kind: 'blur', blur: 36, dim: 0.55 }  blurs and darkens your own footage
   speaker:  { shadow: true, x: 0, y: 0, scale: 1 }   starting framing of the cutout
   moves:    [{ t, dur, x, y, scale }]                 the speaker glides (px offset, scale); each starts where the last ended
   parallax: 0.12                                      the background drifts this fraction of the speaker's move
   foreground: [{ src: 'inputs/mic.prop.png' }]        things that stay IN FRONT of you (z 52): a microphone, a mug. The cutout model
               keeps people only, so cut the prop from one frame:  npm run prop -- inputs/<video>.mp4 --at 8 --box x,y,w,h --name mic --keep dark
   Titles BEHIND your head: mount compositions/tpl/title-behind.html as a host at z-index 30 (see index.html). */
window.__hfCutout = {
  duration: 21.92,
  backgrounds: [
    { t: 0, kind: 'scene', src: 'assets/demo/office.svg', blur: 9, brightness: 0.96, tone: 'neutral' },   // a room (your own: npm run backdrop)
    { t: 12, dur: 1, kind: 'gradient', preset: 'midnight' },     // then a clean studio colour
    { t: 14, dur: 1, kind: 'scene', src: 'assets/demo/office.svg', blur: 16, brightness: 0.7, tone: 'warm' }   // the same room, evening
  ],
  speaker: { shadow: true },
  parallax: 0.12,                                                 // the room drifts a little as the speaker glides
  moves: [
    { t: 14, dur: 1, x: -430, scale: 0.8 },                      // step aside for a card
    { t: 19.5, dur: 1, x: 0, scale: 1 }
  ]
};
