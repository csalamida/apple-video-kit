/**
 * ============================================================================
 * Apple HIG & Keynote Motion System - HyperFrames Animation Controller
 * window.__hfGlass
 * 
 * Authentic Apple Fluid Springs, CASpringAnimation Physics, Camera Choreography,
 * Screen Studio PiP Squircle Docking, and B-Roll Supplements for Video Compositions.
 * Grounded in Apple Human Interface Guidelines (developer.apple.com/design)
 * ============================================================================
 */

(function (root) {
  'use strict';

  var AppleMotion = {
    version: '3.7.0-apple',

    // Apple-style springs as deterministic GSAP ease functions (p in 0..1 -> value).
    // GSAP does NOT parse "cubic-bezier(...)" strings (they silently fall back to power1.out),
    // so springs are solved analytically instead. `bounce` follows SwiftUI: 0 = smooth,
    // .15 = snappy, .3 = bouncy. Damping ratio = 1 - bounce; settles inside the tween duration.
    spring: function (bounce) {
      var z = Math.min(1, Math.max(0.35, 1 - (bounce || 0)));
      var w = 8 / z; // keeps z*w = 8 -> residual < 0.1% at p = 1
      var wd = w * Math.sqrt(Math.max(0, 1 - z * z));
      return function (p) {
        if (p <= 0) return 0;
        if (p >= 1) return 1;
        if (z >= 1) return 1 - (1 + w * p) * Math.exp(-w * p);
        return 1 - Math.exp(-z * w * p) * (Math.cos(wd * p) + (z * w / wd) * Math.sin(wd * p));
      };
    },

    /**
     * 1. Apple Keynote Card Spring Reveal:
     * Micro-scale (0.96 -> 1.0), soft vertical glide (16px -> 0px), and optical de-blur.
     */
    revealCard: function (tl, target, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.48;
      var yFrom = opts.y !== undefined ? opts.y : 16;
      var ease = opts.ease || this.appleEase;

      tl.fromTo(
        target,
        {
          opacity: 0,
          y: yFrom,
          scale: 0.96,
          filter: 'blur(10px)',
        },
        {
          opacity: 1,
          y: 0,
          scale: 1.0,
          filter: 'blur(0px)',
          duration: duration,
          ease: ease,
        },
        start
      );

      return tl;
    },

    /**
     * 2. Apple Keynote Card Dismiss:
     * Subdued downscale (0.97) and optical dissolve.
     */
    hideCard: function (tl, target, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.36;
      var ease = opts.ease || this.appleEase;

      tl.to(
        target,
        {
          opacity: 0,
          y: -10,
          scale: 0.97,
          filter: 'blur(8px)',
          duration: duration,
          ease: ease,
        },
        start
      );

      tl.set(target, { display: 'none' }, start + duration);
      return tl;
    },

    /**
     * 3. Apple Camera Punch-In (1.15x - 1.25x):
     * Smooth, cinematic foveal zoom on speaker thesis or punchline.
     */
    cameraPunchIn: function (tl, cameraSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.45;
      var scale = opts.scale || 1.20;
      var ease = opts.ease || this.ease.smooth;

      tl.to(
        cameraSelector,
        {
          scale: scale,
          transformOrigin: opts.origin || '50% 40%',
          duration: duration,
          ease: ease,
        },
        start
      );
      return tl;
    },

    /**
     * 4. Apple Camera Reframe (Back to 1.0x):
     */
    cameraPunchOut: function (tl, cameraSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.50;
      var ease = opts.ease || this.appleEase;

      tl.to(
        cameraSelector,
        {
          scale: 1.0,
          transformOrigin: '50% 50%',
          duration: duration,
          ease: ease,
        },
        start
      );
      return tl;
    },

    /**
     * 5. Camera Counterbalance Pan:
     * Pans speaker slightly to the side when a graphic card enters.
     */
    counterbalancePan: function (tl, cameraSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.65;
      var xOffset = opts.x !== undefined ? opts.x : (opts.direction === 'right' ? 80 : -80);
      var ease = opts.ease || this.appleEase;

      tl.to(
        cameraSelector,
        {
          x: xOffset,
          duration: duration,
          ease: ease,
        },
        start
      );
      return tl;
    },

    /**
     * STAGE ENGINE - speaker "windows" without layout re-crop.
     * The rig element is a WINDOW (left/top/width/height/radius, squircle, ring+shadow as box-shadow so
     * border and radius stay in true screen pixels). Its content lives in a fixed-size `.hf-pan` child that
     * is only translated/scaled, so footage never re-flows or re-crops while the window morphs.
     * Screen mapping of raw frame point p:  960 + (p - 960) * s + cx   (same as camera.js / __hfTpl.cameraAt)
     */
    stage: {
      FULL: { x: 0, y: 0, w: 1920, h: 1080, r: 0 },
      RING_ON: '0 0 0 2.5px rgba(255, 255, 255, 0.75), 0 28px 70px rgba(0, 0, 0, 0.9), 0 0 40px rgba(41, 151, 255, 0.45)',
      RING_OFF: '0 0 0 0px rgba(255, 255, 255, 0), 0 28px 70px rgba(0, 0, 0, 0), 0 0 40px rgba(41, 151, 255, 0)',

      // Camera {x,y,scale} that frames the source inside `win`.
      //   mode 'frame': whole frame visible (contain).  mode 'cover': fill the window, centred on focus {x,y} (raw px).
      fit: function (win, mode, o) {
        o = o || {};
        var SW = 1920, SH = 1080;
        var s = mode === 'cover' ? Math.max(win.w / SW, win.h / SH) * (o.zoom || 1) : Math.min(win.w / SW, win.h / SH);
        var f = mode === 'cover' ? (o.focus || { x: 960, y: 430 }) : { x: 960, y: 540 };
        var fy = mode === 'cover' ? (o.focusY !== undefined ? o.focusY : 0.42) : 0.5;
        var cx = win.x + win.w / 2 - 960 - (f.x - 960) * s;
        var cy = win.y + win.h * fy - 540 - (f.y - 540) * s;
        if (mode === 'cover') {   // never expose empty video edge inside the window
          cx = Math.min(win.x - 960 + 960 * s, Math.max(win.x + win.w - 960 - 960 * s, cx));
          cy = Math.min(win.y - 540 + 540 * s, Math.max(win.y + win.h - 540 - 540 * s, cy));
        } else {
          cx = win.x + win.w / 2 - 960; cy = win.y + win.h / 2 - 540;
        }
        return { x: cx, y: cy, scale: s };
      },

      // Wraps the rig's children in a fixed-size .hf-pan (idempotent) and returns it.
      pan: function (rig) {
        var el = typeof rig === 'string' ? document.querySelector(rig) : rig;
        var p = el.querySelector(':scope > .hf-pan');
        if (!p) {
          p = document.createElement('div');
          p.className = 'hf-pan';
          p.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:50% 50%';
          while (el.firstChild) p.appendChild(el.firstChild);
          el.appendChild(p);
        }
        p.style.position = 'absolute'; p.style.left = '0px'; p.style.top = '0px';
        p.style.width = '1920px'; p.style.height = '1080px'; p.style.transformOrigin = '50% 50%';
        el.style.overflow = 'hidden';
        return p;
      },

      // Morph the rig to `win` while the pan holds `cam` ({x,y,scale} screen mapping). Seek-safe, no re-crop.
      to: function (tl, rig, win, cam, o) {
        o = o || {};
        var el = typeof rig === 'string' ? document.querySelector(rig) : rig;
        var pan = this.pan(el), at = o.start != null ? o.start : 0, d = o.duration != null ? o.duration : 0.85;
        var ease = o.ease || AppleMotion.ease.smooth;
        if (o.front) tl.set(el, { zIndex: 100 }, at);
        var props = { left: win.x, top: win.y, width: win.w, height: win.h, borderRadius: win.r || 0, duration: d, ease: ease };
        if (o.boxShadow) props.boxShadow = o.boxShadow;
        tl.to(el, props, at);
        tl.to(pan, { x: cam.x - win.x, y: cam.y - win.y, scale: cam.scale, duration: d, ease: ease }, at);
        if (o.front === false) tl.set(el, { zIndex: 10 }, at + d);
        return tl;
      }
    },

    /**
     * 6. Screen Studio Squircle PiP Docking (window + pan: border/radius in screen px, no re-crop).
     * Horizontal = 16:9 whole frame; vertical (9:16) = cover crop centred on the face (opts.focus raw px).
     */
    dockPiP: function (tl, cameraSelector, opts) {
      opts = opts || {};
      var isVertical = opts.orientation === 'vertical' || opts.aspectRatio === '9:16' || opts.mode === 'vertical';
      var win = {
        x: opts.x !== undefined ? opts.x : 96,
        y: opts.y !== undefined ? opts.y : (isVertical ? 580 : 680),
        w: opts.width || (isVertical ? 220 : 420),
        h: opts.height || (isVertical ? 390 : 236),
        r: parseFloat(opts.borderRadius) || (isVertical ? 44 : 36)
      };
      var cam = this.stage.fit(win, isVertical ? 'cover' : 'frame', { focus: opts.focus, zoom: opts.zoom });
      return this.stage.to(tl, cameraSelector, win, cam, {
        start: opts.start || 0, duration: opts.duration || 0.95, ease: opts.ease || this.ease.smooth,
        boxShadow: opts.boxShadow || this.stage.RING_ON, front: true
      });
    },

    /**
     * 7. Undock PiP back to Full Screen:
     */
    undockPiP: function (tl, cameraSelector, opts) {
      opts = opts || {};
      var win = this.stage.FULL;
      return this.stage.to(tl, cameraSelector, win, { x: 0, y: 0, scale: opts.scale || 1 }, {
        start: opts.start || 0, duration: opts.duration || 0.85, ease: opts.ease || this.ease.smooth,
        boxShadow: this.stage.RING_OFF, front: false
      });
    },

    /**
     * 8. iOS Notification Toast Drop In:
     * Drops from top with elastic spring settle.
     */
    toastDropIn: function (tl, toastSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.55;

      tl.fromTo(
        toastSelector,
        {
          opacity: 0,
          y: -40,
          scale: 0.90,
          filter: 'blur(10px)',
        },
        {
          opacity: 1,
          y: 0,
          scale: 1.0,
          filter: 'blur(0px)',
          duration: duration,
          ease: this.ease.bouncy,
        },
        start
      );
      return tl;
    },

    /**
     * 9. iOS Notification Toast Dismiss:
     */
    toastDismiss: function (tl, toastSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.35;

      tl.to(
        toastSelector,
        {
          opacity: 0,
          y: -30,
          scale: 0.92,
          filter: 'blur(8px)',
          duration: duration,
          ease: 'power2.in',
        },
        start
      );
      return tl;
    },

    /**
     * 9b. Apple macOS / iOS Grouped Notification Stack Expand/Collapse:
     */
    toggleNotificationStack: function (tl, stackSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var expand = opts.expand !== undefined ? opts.expand : true;
      var el = typeof stackSelector === 'string' ? document.querySelector(stackSelector) : stackSelector;
      if (!el) return tl;
      var l1 = el.querySelector('.apple-notif-stack-layer-1');
      var l2 = el.querySelector('.apple-notif-stack-layer-2');
      if (expand) {
        if (l1) tl.to(l1, { y: 28, opacity: 0.95, duration: 0.4, ease: this.ease.snappy }, start);
        if (l2) tl.to(l2, { y: 56, opacity: 0.9, duration: 0.4, ease: this.ease.snappy }, start + 0.05);
      } else {
        if (l1 && l2) tl.to([l1, l2], { y: 0, opacity: 1, duration: 0.35, ease: "power2.inOut" }, start);
      }
      return tl;
    },

    /**
     * 10. Staggered Checklist Disclosure (Apple Keynote List Reveal):
     */
    revealList: function (tl, itemsSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var stagger = opts.stagger || 0.12;
      var duration = opts.duration || 0.42;

      tl.fromTo(
        itemsSelector,
        { opacity: 0, x: -16, filter: 'blur(6px)' },
        {
          opacity: 1,
          x: 0,
          filter: 'blur(0px)',
          stagger: stagger,
          duration: duration,
          ease: this.appleEase,
        },
        start
      );
      return tl;
    },

    /**
     * 11. SF Symbol Checkmark Pop (Apple Milestone Completion):
     */
    popCheckmark: function (tl, itemSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.38;

      tl.to(
        itemSelector,
        {
          scale: 1.025,
          duration: duration * 0.5,
          yoyo: true,
          repeat: 1,
          ease: this.ease.smooth,
        },
        start
      );

      return tl;
    },

    /**
     * 12. Tabular Number Counter (Keynote Metric Roll):
     */
    animateCounter: function (tl, elSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 1.1;
      var fromVal = opts.from || 0;
      var toVal = opts.to || 100;
      var prefix = opts.prefix || '';
      var suffix = opts.suffix || '';
      var decimals = opts.decimals || 0;

      var obj = { val: fromVal };
      var el = typeof elSelector === 'string' ? document.querySelector(elSelector) : elSelector;

      if (!el) return tl;

      tl.to(
        obj,
        {
          val: toVal,
          duration: duration,
          ease: this.ease.smooth,
          onUpdate: function () {
            el.textContent = prefix + obj.val.toFixed(decimals) + suffix;
          },
        },
        start
      );

      return tl;
    },

    /**
     * 13. Chat Bubble Pop-In:
     */
    chatBubblePop: function (tl, bubbleSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.40;

      tl.fromTo(
        bubbleSelector,
        {
          opacity: 0,
          scale: 0.85,
          y: 15,
        },
        {
          opacity: 1,
          scale: 1.0,
          y: 0,
          duration: duration,
          ease: this.ease.bouncy,
        },
        start
      );
      return tl;
    },

    /**
     * 14. Apple Kinetic Subtitle Word Burst & Bloom:
     * Liquid glass capsule arrival, word-by-word spring stagger, keyword emphasis bloom.
     */
    kineticTextBurst: function (tl, capsuleSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var capsule = typeof capsuleSelector === 'string' ? document.querySelector(capsuleSelector) : capsuleSelector;
      if (!capsule) return tl;

      var words = capsule.querySelectorAll('.word');
      tl.set(capsule, { display: 'inline-block', opacity: 0, scale: 0.96, y: 8 }, start);
      tl.to(capsule, { opacity: 1, scale: 1, y: 0, duration: 0.28, ease: this.appleEase }, start);

      if (words.length > 0) {
        tl.fromTo(words,
          { opacity: 0, scale: 0.92, y: 4, filter: 'blur(4px)' },
          { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', duration: 0.24, stagger: 0.04, ease: this.ease.snappy },
          start + 0.04
        );
      }

      if (opts.punchSelector) {
        var kw = capsule.querySelector(opts.punchSelector);
        if (kw) {
          tl.to(kw, {
            scale: 1.08,
            duration: 0.18,
            yoyo: true,
            repeat: 1,
            ease: this.ease.smooth,
          }, start + 0.14);
        }
      }

      return tl;
    },

    /**
     * 15. Deterministic Stepper Engine State Update:
     */
    updateStepper: function (badgeElements, activeIndex, completedIndices) {
      if (!badgeElements) return;
      Array.prototype.forEach.call(badgeElements, function (badge, idx) {
        if (!badge) return;
        badge.classList.remove('active', 'completed');
        if (idx === activeIndex) {
          badge.classList.add('active');
        } else if (completedIndices && completedIndices.indexOf(idx) !== -1) {
          badge.classList.add('completed');
        }
      });
    },

    /**
     * 16. Apple Node-to-Node Pipeline Pulse:
     * Traces a glowing specular electric pulse along an SVG spline connector between liquid glass nodes.
     */
    pipelinePulse: function (tl, wireSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.65;
      var wire = typeof wireSelector === 'string' ? document.querySelector(wireSelector) : wireSelector;
      if (!wire) return tl;

      var length = wire.getTotalLength ? wire.getTotalLength() : 200;
      tl.set(wire, { strokeDasharray: length, strokeDashoffset: length, opacity: 1 }, start);
      tl.to(wire, {
        strokeDashoffset: 0,
        duration: duration,
        ease: 'power2.inOut',
      }, start);

      if (opts.targetNode) {
        tl.fromTo(opts.targetNode,
          { scale: 0.98 },
          { scale: 1.04, duration: 0.2, yoyo: true, repeat: 1, ease: this.ease.smooth },
          start + duration * 0.85
        );
      }

      return tl;
    },

    /**
     * 17. Screen Studio Spotlight & Focus Dimmer:
     * Dims and blurs surrounding UI context while elevating the target hero card with an Apple specular glow rim.
     */
    focusSpotlight: function (tl, targetSelector, contextSelectors, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.48;

      if (contextSelectors) {
        tl.to(contextSelectors, {
          opacity: 0.22,
          filter: 'blur(6px)',
          scale: 0.94,
          duration: duration,
          ease: this.ease.smooth,
        }, start);
      }

      tl.to(targetSelector, {
        scale: 1.08,
        y: -4,
        borderColor: 'rgba(45, 104, 255, 0.65)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.85), 0 0 32px rgba(18, 71, 217, 0.55)',
        duration: duration,
        ease: this.ease.snappy,
      }, start);

      return tl;
    },

    /**
     * 18. macOS Interactive Cursor & Spotlight Dimmer:
     * Glides a vector macOS cursor with natural physical deceleration to an element, clicks with a tactile press & ripple.
     */
    cursorClick: function (tl, cursorSelector, targetSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var moveDuration = opts.moveDuration || 0.55;

      // 1. Move cursor smoothly with Apple fluid glide
      tl.to(cursorSelector, {
        x: opts.x !== undefined ? opts.x : 0,
        y: opts.y !== undefined ? opts.y : 0,
        duration: moveDuration,
        ease: this.ease.smooth,
      }, start);

      // 2. Click down (tactile press)
      var clickStart = start + moveDuration + 0.05;
      tl.to(cursorSelector, { scale: 0.88, duration: 0.08, ease: 'power2.in' }, clickStart);
      tl.to(targetSelector, { scale: 0.95, duration: 0.08, ease: 'power2.in' }, clickStart);

      // 3. Release & activate
      tl.to(cursorSelector, { scale: 1.0, duration: 0.14, ease: this.ease.smooth }, clickStart + 0.08);
      tl.to(targetSelector, { scale: 1.0, duration: 0.18, ease: this.ease.snappy }, clickStart + 0.08);

      return tl;
    },

    /**
     * 19. Apple Keynote Broadcast Lower-Third:
     * Frosted liquid glass speaker nameplate with optical unroll and specular light sweep.
     */
    keynoteLowerThird: function (tl, containerSelector, sweepSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.44;

      tl.fromTo(containerSelector,
        { opacity: 0, x: -24, filter: 'blur(6px)' },
        { opacity: 1, x: 0, filter: 'blur(0px)', duration: duration, ease: this.appleEase },
        start
      );

      if (sweepSelector) {
        tl.fromTo(sweepSelector,
          { x: '-100%', opacity: 0.8 },
          { x: '200%', opacity: 0, duration: 0.6, ease: this.ease.smooth },
          start + 0.1
        );
      }

      return tl;
    },

    /**
     * 20. Apple Keynote Center-Stage Emphasis & Corner PiP Dock:
     * Speaker window morphs to a corner card (stage engine: no re-crop) and the thesis text reveals centre-stage.
     */
    keynoteEmphasis: function (tl, textContainer, pipSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.75;
      var position = opts.position || 'bottom-right';

      // 1. Presenter window contracts from full stage into the corner
      if (pipSelector) {
        var pip = typeof pipSelector === 'string' ? document.querySelector(pipSelector) : pipSelector;
        if (pip) {
          var parent = pip.parentElement || document.body;
          var pW = parent.clientWidth || 1920, pH = parent.clientHeight || 1080;
          var w = opts.width || (pW < 600 ? 144 : 420), h = opts.height || (pW < 600 ? 86 : 236);
          var margin = opts.margin || (pW < 600 ? 16 : 48);
          var win = { x: position === 'bottom-left' ? margin : pW - w - margin, y: pH - h - margin, w: w, h: h, r: parseFloat(opts.borderRadius) || (pW < 600 ? 16 : 28) };
          this.stage.to(tl, pip, win, this.stage.fit(win, 'frame'), { start: start, duration: duration, boxShadow: opts.boxShadow || this.stage.RING_ON, front: true });
        }
      }

      // 2. Center-stage text reveal
      if (textContainer) {
        var tc = typeof textContainer === 'string' ? document.querySelector(textContainer) : textContainer;
        if (tc) {
          var eyebrow = tc.querySelector('.emphasis-eyebrow-pill');
          var headline = tc.querySelector('.emphasis-headline');
          var sub = tc.querySelector('.emphasis-sub-desc');

          if (eyebrow) {
            tl.fromTo(eyebrow,
              { opacity: 0, scale: 0.9, y: -6 },
              { opacity: 1, scale: 1, y: 0, duration: 0.35, ease: this.ease.snappy },
              start + 0.2
            );
          }

          if (headline) {
            tl.fromTo(headline,
              { opacity: 0, y: 16, filter: 'blur(8px)' },
              { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.45, ease: this.appleEase },
              start + 0.3
            );
          }

          if (opts.punchSelector) {
            var punch = tc.querySelector(opts.punchSelector);
            if (punch) {
              tl.to(punch, {
                scale: 1.08,
                duration: 0.2,
                yoyo: true,
                repeat: 1,
                ease: this.ease.smooth
              }, start + 0.55);
            }
          }

          if (sub) {
            tl.fromTo(sub,
              { opacity: 0, y: 8 },
              { opacity: 0.85, y: 0, duration: 0.35, ease: this.ease.smooth },
              start + 0.6
            );
          }
        }
      }

      return tl;
    },

    /**
     * 21. Undock Keynote Speaker PiP back to Full Stage:
     */
    undockKeynoteEmphasis: function (tl, textContainer, pipSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.65;
      var pip = typeof pipSelector === 'string' ? document.querySelector(pipSelector) : pipSelector;
      var tc = typeof textContainer === 'string' ? document.querySelector(textContainer) : textContainer;

      if (tc) {
        tl.to(tc.children, { opacity: 0, y: 8, duration: 0.25, stagger: 0.05 }, start);
      }

      if (pip) {
        this.stage.to(tl, pip, this.stage.FULL, { x: 0, y: 0, scale: 1 }, { start: start + 0.1, duration: duration, boxShadow: this.stage.RING_OFF, front: false });
      }
      return tl;
    },

    /**
     * 22. Apple Split-Stage Transition (speaker rail left 38% + live app canvas right):
     * the speaker window becomes a portrait rail whose footage is a face-centred cover crop, no re-crop while it morphs.
     */
    splitStage: function (tl, speakerSelector, appCanvasSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.8;
      var speaker = typeof speakerSelector === 'string' ? document.querySelector(speakerSelector) : speakerSelector;
      var appCanvas = typeof appCanvasSelector === 'string' ? document.querySelector(appCanvasSelector) : appCanvasSelector;
      if (!speaker) return tl;

      var parent = speaker.parentElement || document.body;
      var pW = parent.clientWidth || 1920, pH = parent.clientHeight || 1080;
      var margin = opts.margin || (pW < 600 ? 12 : 36), gap = opts.gap || (pW < 600 ? 12 : 32);
      var availW = pW - margin * 2 - gap;
      var leftW = opts.speakerWidth || Math.round(availW * 0.38);
      var rightW = availW - leftW, contentH = pH - margin * 2;
      var rightTop = margin, rightLeft = margin + leftW + gap;
      var borderRadius = opts.borderRadius || (pW < 600 ? 16 : 24);
      var win = { x: margin, y: margin, w: leftW, h: contentH, r: borderRadius };
      var cam = this.stage.fit(win, 'cover', { focus: opts.focus, zoom: opts.zoom, focusY: opts.focusY });
      this.stage.to(tl, speaker, win, cam, { start: start, duration: duration, boxShadow: '0 20px 48px rgba(0, 0, 0, 0.85)' });

      // 2. macOS Glass App Canvas glides in from right
      if (appCanvas) {
        tl.set(appCanvas, {
          top: rightTop,
          left: rightLeft,
          width: rightW,
          height: contentH,
          borderRadius: borderRadius,
          x: 40,
          opacity: 0,
          pointerEvents: 'auto'
        }, start);

        tl.to(appCanvas, {
          x: 0,
          opacity: 1,
          duration: duration,
          ease: this.appleEase
        }, start + 0.1);
      }

      return tl;
    },

    /**
     * 23. Undock Split-Stage back to Full Speaker:
     */
    unsplitStage: function (tl, speakerSelector, appCanvasSelector, opts) {
      opts = opts || {};
      var start = opts.start !== undefined ? opts.start : 0;
      var duration = opts.duration || 0.65;
      var speaker = typeof speakerSelector === 'string' ? document.querySelector(speakerSelector) : speakerSelector;
      var appCanvas = typeof appCanvasSelector === 'string' ? document.querySelector(appCanvasSelector) : appCanvasSelector;

      if (appCanvas) {
        tl.to(appCanvas, {
          x: 30,
          opacity: 0,
          duration: duration * 0.5,
          ease: 'power2.in'
        }, start);
      }

      if (speaker) {
        this.stage.to(tl, speaker, this.stage.FULL, { x: 0, y: 0, scale: 1 }, { start: start + 0.1, duration: duration, boxShadow: 'none', front: false });
      }
      return tl;
    }
  };

  AppleMotion.ease = {
    smooth: AppleMotion.spring(0),     // no overshoot: opacity, blur, camera, layout moves
    snappy: AppleMotion.spring(0.15),  // slight settle: cards, pills, badges
    bouncy: AppleMotion.spring(0.3)    // playful: toasts, chat bubbles, checkmarks
  };
  AppleMotion.appleEase = AppleMotion.ease.smooth; // legacy name used throughout this file

  root.__hfGlass = AppleMotion;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AppleMotion;
  }
})(typeof window !== 'undefined' ? window : this);
