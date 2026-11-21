import {html, css, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {styleMap} from 'lit/directives/style-map.js';
import {keyed} from 'lit/directives/keyed.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';

/**
 * Ring diameters as a percentage of the square stage — the single source of truth for
 * ring geometry. CSS sizes each ring from this via the `--d` custom property.
 *
 * One ring per on-path refining state; the core is the AI-ready terminal. Off-path
 * exits get no ring at all — see the legend's exit group.
 */
const RING_DIAMETER = {1: 88, 2: 70, 3: 54, 4: 39};

/**
 * Orbit-dot colour per ring — the same ripening ramp the legend dots use
 * (`.dot-1`..`.dot-4`): raw grey at the rim, AI-ready green at the core. `body` paints
 * the dot; `tint` is the same hue as an rgb triplet, for its contact ring, bloom and
 * wake. Keyed by `stage.ringIndex`, not array position.
 */
const RING_TINT = {
  1: {body: '#cfcecb', tint: '207, 206, 203'},
  2: {body: '#b6c4c1', tint: '182, 196, 193'},
  3: {body: '#4fb8ae', tint: '79, 184, 174'},
  4: {body: '#00b271', tint: '0, 178, 113'}
};

/**
 * Longest the example's own open/close transition can run, plus slack. Only a
 * fallback: `transitionend` is what normally settles it, and this exists so the
 * inline height and the animating class are still cleaned up in the cases where
 * that event never arrives — the pane being replaced by a stage change mid-flight,
 * most of all.
 */
const EXAMPLE_ANIM_TIMEOUT_MS = 700;

/**
 * One full lap of the selected ring. Deliberately unhurried — the dot is there to say
 * "this is the ring you're looking at", not to race.
 */
const ORBIT_MS = 4200;

/**
 * The refining-path visualization — a light radial hero showing the path as concentric
 * hairline rings narrowing toward an AI-ready core. The rings are hairlines, not
 * meters: selecting a state is what marks it, by riding a single tinted dot around
 * that state's own ring for as long as it stays selected.
 *
 * The right-hand pane is master/detail against the rings. At rest it lists the five
 * states; choosing one narrows the rings (which slides it left, since the pane takes
 * the width back) and replaces the list with that state on its own — its number and
 * sub-label, its name set large, and the step's actual input and output side by side,
 * so what happens there is shown rather than described.
 *
 * That input/output pair (`stage.example`) is one real article's own real content at
 * each step — the same article threaded through all five stages, picked via the
 * `articles`/`selectedArticleId` selector rendered in the top control row and changed
 * by firing `pipeline-tunnel:article-select` with `{id}`. `stage.example` is `null`
 * when that article hasn't reached this stage yet — `stage.emptyMessage` renders in
 * its place rather than leaving the pane blank.
 *
 * The palette is inverted from the usual dark-hero treatment on purpose: the field is
 * warm paper and hairline graphite, and all the saturation lives in the orbiting dot
 * and the core the rings narrow into. The dot ripens through RING_TINT from rim to
 * core, the same ramp the legend dots use, so how far along the path a state sits is
 * legible from colour alone.
 *
 * A stage's `kind` decides how it is drawn, not its position in the array:
 * `ring` states get a ring and a numbered legend row, `core` is the center, and `exit`
 * states get neither — they are terminals off the path, listed as a subordinate group
 * below the tablist. The cross-article duplicate pass gets a badge instead of any of
 * the above, since it operates on pairs and no article ever occupies it.
 *
 * Fires `pipeline-tunnel:stage-select` with `{id}` when a stage tab is chosen; owns none
 * of that state itself so the page can drive it. The kanban board below the hero is the
 * accessible route into any individual article.
 */
@customElement('pipeline-tunnel')
export default class PipelineTunnel extends AIUXElement {
  @property({attribute: false}) stages = [];
  @property({type: String}) selected = '';
  /** Count shown in the "in flight" readout. */
  @property({type: Number}) inFlight = 0;
  /** `{kicker, name, desc, count, unit}` for the source node docked at the rim. */
  @property({attribute: false}) source = null;
  /** `[{label, value, tone}]` for the score progression strip; omit to hide it. */
  @property({attribute: false}) scoreTrack = null;
  /** Sentence shown under the score strip, explaining what the numbers share. */
  @property({type: String}) scoreNote = '';
  /** `[{id, title}]` — every real article in the current job, for the article selector below. */
  @property({attribute: false}) articles = [];
  /** Which of `articles` the stage detail's real example is currently showing. */
  @property({type: String}) selectedArticleId = '';

  /**
   * Whether the focused state's in/out example is showing in full. Starts closed on
   * every state, so opening any of the five costs the same amount of page — see
   * `.detail-region`'s own min-height for the other half of that.
   */
  @state() _expanded = false;
  /**
   * Whether the clamped example actually has more to show. Measured rather than
   * assumed: a short example (or one whose article stopped early) has nothing to
   * expand, and a "More" control that does nothing when clicked is worse than none.
   */
  @state() _exampleOverflows = false;

  /**
   * True for the length of an open/close transition. Not reactive — nothing renders
   * off it; it exists to hold `_measureExample` off while the inline height it would
   * otherwise measure is mid-transition, which would read as "nothing to expand" and
   * drop the control out from under the reader's own click.
   */
  _animatingExample = false;
  _exampleAnimTimer = 0;

  /**
   * Set synchronously by a row or back click, consumed by updated() once the target
   * actually exists. Replacing the list with the detail moves the thing the user was
   * on out of the DOM, so focus has to be handed somewhere deliberate — otherwise it
   * falls back to the document and keyboard users lose their place.
   */
  _pendingFocus = null;

  static styles = css`
    /*
     * "The lens", light: the field is warm paper and hairline graphite, and every bit
     * of saturation lives in the travelling orbs and the core they fall into. That
     * inversion is the whole point — a dark hero on a light page reads as a foreign
     * object, so the charge moved into the things that actually move.
     *
     * Still a deliberately fixed art surface rather than a themed one, so its palette
     * lives here as one tunable block instead of tracking light/dark.
     */
    :host {
      display: block;
      --ln-ink: #171614;
      --ln-ink-soft: #4d4c4a;
      --ln-ink-dim: #8a8986;
      --ln-ink-faint: #b4b3b0;
      --ln-paper: #ffffff;
      --ln-paper-warm: #faf9f7;
      --ln-hairline: #e3e2df;
      --ln-hairline-soft: #e8e7e4;
      --ln-rule: #d6d5d1;
      --ln-teal: #00af9f;
      --ln-teal-deep: #00847a;
      --ln-green: #00b271;
      --ln-green-deep: #00532f;
      --ln-green-line: #9fd8bb;
      --ln-amber: #dc8900;
      --ln-amber-deep: #6c3e00;
      --ln-red: #be0003;
      --ln-red-deep: #970000;
    }

    /* ── hero shell ─────────────────────────────────────────────────────── */
    /*
     * The hero's own layout lives here rather than in Tailwind utilities on the
     * markup, even though utilities are used freely elsewhere in this app.
     *
     * tailwind.app.css reaches a component through adoptedStyleSheets — see its
     * own header comment — and that is a script-only API: a constructable
     * stylesheet cannot be server-rendered into declarative shadow DOM. So on the
     * SSR'd first paint, no flex / gap-* / p-* / xl:flex-row rule exists inside
     * this shadow root at all, and every one of these boxes lays out as a plain
     * block — which is what dropped the state list underneath the rings instead of
     * beside them, and left the hero with no padding. Building the element
     * client-side (navigating away and back) adopts the sheet, which is exactly why
     * it looked right the second time and not the first.
     *
     * static styles is emitted as a real <style> inside the declarative shadow
     * root, so these rules are there at first paint. Values are the px equivalents
     * of the utilities they replace (gap-6/gap-8/gap-3 = 24/32/12px, p-6/p-8 =
     * 24/32px), written in px like the rest of this file rather than rem.
     */
    .tunnel-hero {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 24px;
      padding: 24px;
      border-radius: var(--radius-2xl, 1rem);
      color: var(--ln-ink);
      background: radial-gradient(
        90% 80% at 42% 50%,
        #ffffff 0%,
        var(--ln-paper-warm) 52%,
        #f4f3f0 100%
      );
      border: 1px solid var(--ln-hairline);
    }
    @media (min-width: 1024px) {
      .tunnel-hero {
        padding: 32px;
      }
    }

    /* The top control row: the article selector and the in-flight readout. */
    .hero-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
    }

    /*
     * Source, rings and detail. Stacked until there is room for the three columns,
     * then side by side — on the same 1280px breakpoint the source-wrap collapse
     * and .detail-region's own height floor already use, since all three have to
     * agree about when the columns exist.
     */
    .hero-row {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 32px;
    }
    @media (min-width: 1280px) {
      .hero-row {
        flex-direction: row;
        gap: 24px;
      }
    }

    .top-pill {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px 18px;
      border-radius: 14px;
      background: var(--ln-paper);
      border: 1px solid var(--ln-hairline);
    }
    .top-pill-label {
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ln-ink-dim);
    }
    .top-pill-value {
      font-family: var(--font-mono);
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--ln-ink);
    }

    /* ── article selector ──────────────────────────────────────────────── */
    .article-select-wrap {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px 14px;
      border-radius: 14px;
      background: var(--ln-paper);
      border: 1px solid var(--ln-hairline);
    }
    .article-select-label {
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ln-ink-dim);
    }
    .article-select {
      max-width: 220px;
      border: none;
      background: transparent;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      color: var(--ln-ink);
      cursor: pointer;
    }
    .article-select:focus-visible {
      outline: 2px solid var(--ln-ink);
      outline-offset: 2px;
    }

    /* ── source, docked at the rim ──────────────────────────────────────── */
    .source-card {
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: 200px;
      padding: 16px 18px 18px 18px;
      box-sizing: border-box;
      border-radius: 16px;
      background: var(--ln-paper);
      border: 1px solid var(--ln-rule);
      box-shadow:
        0 1px 2px rgba(23, 22, 20, 0.05),
        0 12px 26px -22px rgba(23, 22, 20, 0.35);
    }
    /* A small stack of as-authored pages, deliberately drawn as slabs rather than
       an icon — it is the one thing on this surface that should look unrefined. */
    .sheets {
      position: relative;
      height: 62px;
      margin-bottom: 13px;
    }
    .sheet {
      position: absolute;
      width: 96px;
      height: 52px;
      border-radius: 5px;
      background: #f4f3f0;
      border: 1px solid var(--ln-hairline);
    }
    .sheet-back {
      left: 12px;
      top: 6px;
      rotate: -5deg;
    }
    .sheet-front {
      left: 15px;
      top: 0;
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 9px;
      box-sizing: border-box;
      background: var(--ln-paper);
      border-color: var(--ln-rule);
    }
    .sheet-line {
      height: 3px;
      border-radius: 2px;
      background: #e8e7e4;
    }
    .sheet-line-head {
      width: 70%;
      height: 4px;
      background: var(--ln-rule);
    }
    .sheet-line-full {
      width: 100%;
    }
    .sheet-line-short {
      width: 88%;
    }
    .sheet-line-mid {
      width: 94%;
    }
    .node-kicker {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ln-ink-dim);
    }
    .node-name {
      margin-top: 4px;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .node-desc {
      margin-top: 3px;
      font-size: 12px;
      line-height: 1.4;
      color: var(--ln-ink-soft);
    }
    .node-count {
      display: flex;
      align-items: baseline;
      gap: 5px;
      margin-top: 12px;
      padding-top: 11px;
      border-top: 1px solid #edece9;
    }
    .node-count-value {
      font-family: var(--font-mono);
      font-size: 21px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .node-count-unit {
      font-size: 11.5px;
      color: var(--ln-ink-dim);
    }

    /* ── the lens ───────────────────────────────────────────────────────── */
    /*
     * The focus transition animates WIDTH, not transform: scale(). The rings and the
     * orbit radii are both sized in cqw off this element, and the run loop rewrites
     * every orb's transform each frame — so shrinking the width re-resolves cqw and
     * the rings and any in-flight orbs follow it, staying pixel-crisp. Scaling would
     * put the 1px hairlines on half-pixels and blur them.
     *
     * Focusing and unfocusing are asymmetric, and each state's own rule owns the
     * transition INTO it: tunnel-zone-compact is what animates when a state is opened,
     * so the long decelerating ramp lives there — it is the slowest thing on this
     * surface and the one the eye actually follows. The base .tunnel-zone rule alone
     * owns the way back out, which keeps the shorter duration and the symmetric curve
     * this had all along — only opening a state was asked to slow down.
     */
    .tunnel-zone {
      flex: 0 0 auto;
      width: min(560px, 100%);
      transition: width var(--duration-xl) var(--ease-medium-accel);
    }
    .tunnel-zone-compact {
      width: min(340px, 100%);
      transition: width var(--duration-2xl) var(--ease-enter);
    }

    /* The detail pane takes whatever the rings give back, so "move left" is just
       the flex row reflowing as the zone narrows. */
    .detail-pane {
      flex: 1 1 0;
      min-width: 0;
      width: 100%;
    }

    /*
     * The source is context for the resting state only — once a stage is focused the
     * stage itself is the context, so it collapses out of the row. Only above the
     * breakpoint where the three columns actually sit side by side; below it the
     * layout stacks and there is room for everything.
     */
    .source-wrap {
      display: flex;
      align-items: center;
    }
    @media (min-width: 1280px) {
      .source-wrap {
        overflow: hidden;
        max-width: 260px;
        opacity: 1;
        transition:
          max-width var(--duration-xl) var(--ease-medium-accel),
          opacity var(--duration-sm) linear;
      }
      /* Collapses on the same ramp as the zone it hands its width to, so the two
         read as one movement rather than two overlapping ones. */
      .source-wrap-collapsed {
        max-width: 0;
        opacity: 0;
        transition:
          max-width var(--duration-2xl) var(--ease-enter),
          opacity var(--duration-md) linear;
      }
    }
    .tunnel-stage {
      position: relative;
      container-type: inline-size;
      width: 100%;
      aspect-ratio: 1;
      margin-inline: auto;
    }

    /* A faint charge in the middle, so the centre reads as active with no dark field. */
    .stage-bloom {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 68cqw;
      height: 68cqw;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      pointer-events: none;
      background: radial-gradient(
        closest-side circle,
        rgba(0, 178, 113, 0.07) 0%,
        rgba(0, 175, 159, 0.035) 46%,
        transparent 74%
      );
      animation: stage-shimmer 7s ease-in-out infinite;
    }
    @keyframes stage-shimmer {
      0%,
      100% {
        opacity: 0.72;
      }
      50% {
        opacity: 1;
      }
    }

    .ring {
      position: absolute;
      left: 50%;
      top: 50%;
      width: var(--d);
      height: var(--d);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      border: 1px solid var(--line);
      transition:
        border-color var(--duration-lg) linear,
        box-shadow var(--duration-lg) linear;
    }
    /* Hairlines warm from graphite toward teal as they near the core. */
    .ring-1 {
      --line: #e0dfdc;
      --glow: rgba(0, 175, 159, 0.16);
    }
    .ring-2 {
      --line: #dad9d5;
      --glow: rgba(0, 175, 159, 0.2);
    }
    .ring-3 {
      --line: rgba(0, 175, 159, 0.34);
      --glow: rgba(0, 175, 159, 0.24);
      box-shadow: 0 0 0 4px rgba(0, 175, 159, 0.05);
    }
    .ring-4 {
      --line: rgba(0, 178, 113, 0.3);
      --glow: rgba(0, 178, 113, 0.28);
    }
    .ring-active {
      border-color: var(--ln-teal);
      box-shadow: 0 0 0 4px rgba(0, 175, 159, 0.09);
    }

    /* ── orbiting dot ──────────────────────────────────────────────────── */
    /*
     * Rides the selected state's own hairline for as long as that state stays
     * selected. On paper a dot cannot glow by being brighter than its surroundings,
     * so it glows by being SATURATED against a desaturated field: a glossy body with
     * a specular highlight, a tinted contact ring, and a soft bloom in its own hue.
     * --orb-body / --orb-tint come from RING_TINT, so the dot ripens from raw grey at
     * the rim to AI-ready green at the core.
     *
     * --r is the ring's own radius in cqw (half its RING_DIAMETER), so the dot rides
     * exactly ON the hairline instead of drifting inside it — and because both are
     * cqw off .tunnel-stage, the orbit re-resolves with the zone's focus resize
     * rather than needing to be recomputed.
     */
    .orbit-dot {
      --orb-body: var(--ln-green);
      --orb-tint: 0, 178, 113;
      position: absolute;
      top: 50%;
      left: 50%;
      width: 13px;
      height: 13px;
      margin: -6.5px 0 0 -6.5px;
      border-radius: 50%;
      pointer-events: none;
      will-change: transform;
      /* Flat hue first: a browser without color-mix() drops the gradient entirely,
         and a dot with only a box-shadow is an invisible dot. */
      background: var(--orb-body);
      background: radial-gradient(
        circle at 34% 30%,
        #ffffff 0%,
        color-mix(in srgb, var(--orb-body) 45%, #ffffff) 44%,
        var(--orb-body) 100%
      );
      box-shadow:
        0 0 0 3px rgba(var(--orb-tint), 0.14),
        0 0 18px 6px rgba(var(--orb-tint), 0.26);
      animation: orbit var(--orbit-ms) linear infinite;
    }
    /* Wake — the dot's local x-axis is the orbit tangent, so this trails it. */
    .orbit-dot::before {
      content: '';
      position: absolute;
      top: 50%;
      right: 50%;
      width: 24px;
      height: 3px;
      transform: translateY(-50%);
      border-radius: 999px;
      filter: blur(1.5px);
      background: linear-gradient(
        to left,
        rgba(var(--orb-tint), 0.5) 0%,
        rgba(var(--orb-tint), 0.16) 45%,
        transparent 100%
      );
    }
    /* Starts at twelve o'clock, where the ring's own index tick sits. */
    @keyframes orbit {
      from {
        transform: rotate(0deg) translateY(calc(var(--r) * -1));
      }
      to {
        transform: rotate(360deg) translateY(calc(var(--r) * -1));
      }
    }

    /* Ring index ticks, sitting on each hairline at twelve o'clock. */
    .ring-tick {
      position: absolute;
      left: 50%;
      /* --tick-inset is the ring's own edge inset, handed down per ring. */
      top: calc(var(--tick-inset) - 6px);
      transform: translateX(-50%);
      padding: 0 5px;
      background: var(--ln-paper-warm);
      font-family: var(--font-mono);
      font-size: clamp(8px, 1.75cqw, 9.5px);
      font-weight: 600;
      color: var(--ln-ink-faint);
    }
    .ring-tick-active {
      color: var(--ln-teal-deep);
    }

    /* ── core ──────────────────────────────────────────────────────────── */
    .core-aura {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 54cqw;
      height: 54cqw;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      will-change: transform, opacity;
      background: radial-gradient(
        closest-side circle,
        rgba(0, 178, 113, 0.2) 0%,
        rgba(0, 178, 113, 0.07) 44%,
        transparent 74%
      );
      animation: aura-breathe 6s ease-in-out infinite;
    }
    @keyframes aura-breathe {
      0%,
      100% {
        opacity: 0.62;
        scale: 1;
      }
      50% {
        opacity: 1;
        scale: 1.05;
      }
    }

    .core {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1px;
      width: 27cqw;
      height: 27cqw;
      min-width: 92px;
      min-height: 92px;
      border-radius: 50%;
      background: radial-gradient(
        circle at 42% 34%,
        #ffffff 0%,
        #ffffff 52%,
        #eefaf3 100%
      );
      border: 1px solid var(--ln-green-line);
      box-shadow:
        0 0 0 6px rgba(0, 178, 113, 0.08),
        0 18px 40px -26px rgba(0, 131, 79, 0.6);
      text-align: center;
      z-index: 2;
      transition: box-shadow var(--duration-lg) linear;
    }
    .core-selected {
      box-shadow:
        0 0 0 8px rgba(0, 178, 113, 0.14),
        0 18px 40px -22px rgba(0, 131, 79, 0.7);
    }
    .core-label {
      font-family: var(--font-mono);
      /* cqw-based, so the core stays legible when the lens shrinks to focus a stage. */
      font-size: clamp(7.5px, 1.75cqw, 9.5px);
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--ln-teal-deep);
    }
    .core-num {
      font-family: var(--font-mono);
      font-size: clamp(19px, 6cqw, 32px);
      font-weight: 600;
      line-height: 1.08;
      letter-spacing: -0.03em;
      color: var(--ln-green-deep);
    }
    .core-unit {
      font-size: clamp(8px, 2cqw, 11px);
      color: #7d9a8c;
    }

    /* ── legend / tablist ──────────────────────────────────────────────── */
    .legend-list {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .legend-row {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 12px;
      padding: 9px 13px;
      border-radius: 11px;
      border: 1px solid var(--ln-hairline-soft);
      background: var(--ln-paper);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition:
        border-color var(--duration-sm) linear,
        box-shadow var(--duration-sm) linear,
        transform var(--duration-sm) var(--ease-medium-accel);
    }
    .legend-row:hover {
      transform: translateX(2px);
      border-color: var(--ln-rule);
    }
    .legend-row:focus-visible {
      outline: 2px solid var(--ln-ink);
      outline-offset: 2px;
    }
    .legend-row-active {
      border-color: #9ecfc9;
      box-shadow:
        inset 2px 0 0 var(--ln-teal),
        0 0 0 3px rgba(0, 175, 159, 0.08);
    }
    .legend-index {
      width: 17px;
      flex-shrink: 0;
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 600;
      color: var(--ln-ink-faint);
    }
    .legend-row-active .legend-index {
      color: var(--ln-teal-deep);
    }
    .legend-dot {
      width: 11px;
      height: 11px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    /* Same ripening ramp the orbs follow: raw grey at the rim, green at the core. */
    .dot-1 {
      background: #cfcecb;
    }
    .dot-2 {
      background: #b6c4c1;
    }
    .dot-3 {
      background: #4fb8ae;
    }
    .dot-4 {
      background: var(--ln-green);
    }
    /* The core's own, set apart from the four ring dots above it: the path is four
       rings plus the centre, so the fifth row is always the AI-ready terminal. */
    .dot-5 {
      width: 14px;
      height: 14px;
      background: var(--ln-green);
      box-shadow: 0 0 0 3px rgba(0, 178, 113, 0.16);
    }
    .legend-text {
      flex: 1;
      min-width: 0;
    }
    .legend-name {
      display: block;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--ln-ink);
    }
    .legend-meta {
      display: block;
      font-size: 11px;
      color: var(--ln-ink-dim);
    }
    .legend-count {
      font-family: var(--font-mono);
      font-size: 13.5px;
      font-weight: 600;
      color: var(--ln-ink);
      flex-shrink: 0;
    }
    .legend-chevron {
      display: flex;
      flex-shrink: 0;
      color: var(--ln-ink-faint);
      transition: transform var(--duration-sm) var(--ease-medium-accel);
    }
    .legend-row:hover .legend-chevron {
      transform: translateX(2px);
      color: var(--ln-ink-dim);
    }
    .legend-row-core {
      background: #f4fbf7;
      border-color: #b7e0cb;
    }
    .legend-row-core .legend-name,
    .legend-row-core .legend-count {
      color: var(--ln-green-deep);
    }
    .legend-row-core .legend-meta {
      color: #6f9080;
    }
    .legend-row-core .legend-index {
      color: var(--ln-teal-deep);
    }

    /* ── focused stage detail ─────────────────────────────────────────── */
    /*
     * Replaces the list rather than expanding inside it, so the title can be set at a
     * real size and the in/out comparison gets the full width the lens gives back.
     */
    /*
     * Delayed so the zone's own resize is most of the way done before the new pane
     * starts arriving — container before content, rather than both moving at once.
     * Split into two animations because opacity must ease linearly and the slide
     * must not.
     */
    .pane-body {
      animation:
        pane-slide var(--duration-lg) var(--ease-enter) var(--delay-150) both,
        pane-fade var(--duration-md) linear var(--delay-150) both;
    }
    @keyframes pane-slide {
      from {
        transform: translateY(6px);
      }
      to {
        transform: none;
      }
    }
    @keyframes pane-fade {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    /* space-between rather than a spacer, so the row is correct with or without the
       Next control (the last state on the path has none). */
    .detail-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 12px;
    }
    .nav-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      padding: 5px 10px 5px 6px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      color: var(--ln-ink-soft);
      cursor: pointer;
      transition:
        background-color var(--duration-sm) linear,
        color var(--duration-sm) linear;
    }
    /* Mirror of the back control: the chevron trails the label, so the padding does
       too. The state name can be long, so it truncates rather than wrapping the row. */
    .nav-btn-next {
      padding: 5px 6px 5px 10px;
    }
    .nav-btn-next > span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nav-btn:hover {
      background: #f4f3f0;
      color: var(--ln-ink);
    }
    .nav-btn:focus-visible {
      outline: 2px solid var(--ln-ink);
      outline-offset: 2px;
    }

    .detail-head {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .detail-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      border-radius: 11px;
      background: #f4f3f0;
      color: var(--ln-teal-deep);
    }
    .detail-icon-core {
      background: #f4fbf7;
      color: var(--ln-green-deep);
    }
    .detail-icon-neutral {
      color: var(--ln-ink-soft);
    }
    .detail-eyebrow {
      display: block;
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ln-ink-dim);
    }
    .detail-title {
      margin: 1px 0 0 0;
      font-size: 26px;
      line-height: 1.1;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--ln-ink);
    }
    .detail-count {
      margin-top: 10px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--ln-ink-dim);
    }
    .detail-desc {
      margin: 8px 0 0 0;
      max-width: 62ch;
      font-size: 13.5px;
      line-height: 1.6;
      color: var(--ln-ink-soft);
      text-wrap: pretty;
    }
    /* Shown instead of the in/out example when the selected article hasn't
       reached this stage yet (or produced no example-worthy content for it). */
    .example-empty {
      margin: 18px 0 0 0;
      padding: 13px 15px;
      max-width: 62ch;
      border-radius: 10px;
      border: 1px dashed var(--ln-rule);
      background: var(--ln-paper-warm);
      font-size: 12.5px;
      font-style: italic;
      line-height: 1.5;
      color: var(--ln-ink-dim);
    }

    /*
     * Every focused state gets the same amount of page, whatever its example
     * happens to weigh. .detail-region sets that one height and the clamped example
     * absorbs whatever the rest of the pane leaves — flex: 1 1 0, off a basis of
     * zero, so it takes the free space rather than contributing its own (very
     * variable) content height to the total.
     *
     * That is what makes the five states the same size, and it does it in both
     * directions: a heavy state (analyzed, whose example is a whole article body) is
     * cut down to the space available, and a light one is padded out to it, instead
     * of the hero resizing every time the selection moves down the path.
     *
     * The floor is only applied where the three columns actually sit side by side;
     * below that breakpoint the layout stacks, there is no ring column to stay level
     * with, and the min-height below carries the clamp on its own.
     */
    .detail-region {
      display: flex;
      flex-direction: column;
    }
    @media (min-width: 1280px) {
      .detail-region {
        min-height: 470px;
      }
    }
    .example-collapse {
      position: relative;
    }
    /*
     * Fades the cut rather than slicing a line of type in half, so the clamp reads
     * as "there is more" instead of as a rendering fault. Declared here at zero
     * opacity rather than only on the clamped state, so it has something to
     * transition between: it fades out as the example opens and back in as it
     * closes, instead of blinking off with the class.
     */
    .example-collapse::after {
      content: '';
      position: absolute;
      inset: auto 0 0 0;
      height: 56px;
      opacity: 0;
      pointer-events: none;
      background: linear-gradient(
        to bottom,
        rgba(255, 255, 255, 0) 0%,
        var(--ln-paper) 82%
      );
      /* The exit — whichever rule is active AFTER the change owns the timing, and
         this one is active once the clamp is gone. Opacity is always linear. */
      transition: opacity var(--duration-xs) linear;
    }
    .example-collapse-clamped {
      flex: 1 1 0;
      /* The floor, for the stacked layout and for a pane whose own header text has
         eaten more than its share — better a short example than a squashed one. */
      min-height: 176px;
      overflow: hidden;
    }
    .example-collapse-clamped::after {
      opacity: 1;
      transition-duration: var(--duration-sm);
    }
    /*
     * The open/close transition, applied only while one is actually running —
     * see _runExampleHeightTransition, which measures both ends and writes the
     * height inline.
     *
     * Height, not the grid-template-rows 0fr→1fr the design system prefers for
     * expand/collapse: that pattern needs the concealed part to be its own grid
     * child, and this clamp cuts mid-content (part-way down a code block), not at
     * any structural boundary there is to split on. Height is the documented
     * fallback for exactly that case, on the condition that the target height is
     * known — and it is, measured before each run rather than guessed.
     *
     * Must stay after .example-collapse-clamped: closing runs with both classes
     * on, they are the same specificity, and this one's flex has to win so the
     * inline height governs instead of the clamp's own flex sizing.
     */
    .example-collapse-animating {
      flex: 0 0 auto;
      overflow: hidden;
      transition: height var(--duration-lg) var(--ease-medium-accel);
    }
    /* Closing is an exit, so it runs faster than opening. */
    .example-collapse-animating-out {
      transition-duration: var(--duration-md);
    }
    .example-toggle {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-top: 10px;
      padding: 6px 11px 6px 12px;
      border-radius: 999px;
      border: 1px solid var(--ln-rule);
      background: var(--ln-paper);
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--ln-ink-soft);
      cursor: pointer;
      transition:
        border-color var(--duration-sm) linear,
        color var(--duration-sm) linear;
    }
    .example-toggle:hover {
      border-color: var(--ln-teal);
      color: var(--ln-teal-deep);
    }
    .example-toggle:focus-visible {
      outline: 2px solid var(--ln-ink);
      outline-offset: 2px;
    }
    .example-toggle-chevron {
      display: inline-flex;
      transition: transform var(--duration-sm) var(--ease-medium-accel);
    }
    .example-toggle-open .example-toggle-chevron {
      transform: rotate(180deg);
    }

    /* ── in / out comparison ──────────────────────────────────────────── */
    .example-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
      margin-top: 18px;
    }
    .example-arrow {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--ln-ink-faint);
      rotate: 90deg;
    }
    /* Side by side only once there is width for it; stacked below, with the arrow
       turned to match the reading direction. */
    @media (min-width: 900px) {
      .example-grid {
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: stretch;
      }
      .example-arrow {
        rotate: none;
      }
    }
    .example-col {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .example-label {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ln-ink-dim);
    }
    .example-col-out .example-label {
      color: var(--ln-teal-deep);
    }
    .example-caption {
      font-size: 11.5px;
      line-height: 1.45;
      color: var(--ln-ink-dim);
      text-wrap: pretty;
    }
    .code-block {
      margin: 0;
      flex-grow: 1;
      padding: 11px 13px;
      border-radius: 10px;
      background: var(--ln-paper-warm);
      border: 1px solid var(--ln-hairline);
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.6;
      color: var(--ln-ink-soft);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      tab-size: 2;
    }
    .example-col-out .code-block {
      background: #f8fcfa;
      border-color: #cfe8db;
      color: #22493a;
    }
    .item-list {
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      gap: 1px;
      padding: 5px;
      border-radius: 10px;
      background: var(--ln-paper-warm);
      border: 1px solid var(--ln-hairline);
    }
    .example-col-out .item-list {
      background: #f8fcfa;
      border-color: #cfe8db;
    }
    .item-row {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 7px 9px;
      border-radius: 7px;
      background: var(--ln-paper);
    }
    .item-label {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 600;
      color: var(--ln-ink-faint);
    }
    .example-col-out .item-label {
      color: var(--ln-teal-deep);
    }
    .item-text {
      font-size: 12.5px;
      line-height: 1.45;
      color: var(--ln-ink-soft);
      text-wrap: pretty;
    }

    /* ── score progression ─────────────────────────────────────────────── */
    .score-track {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 13px 18px;
      border-radius: 14px;
      background: var(--ln-paper);
      border: 1px solid var(--ln-hairline);
    }
    .score-step {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .score-label {
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ln-ink-dim);
    }
    .score-value {
      font-family: var(--font-mono);
      font-size: 18px;
      font-weight: 600;
      color: var(--ln-ink);
    }
    .score-value-raw {
      color: var(--ln-ink-faint);
    }
    .score-value-mid {
      color: #4fb8ae;
    }
    .score-value-final {
      color: var(--ln-green);
    }
    .score-note {
      max-width: 340px;
      font-size: 12px;
      line-height: 1.45;
      color: var(--ln-ink-soft);
    }

    /* ── reduced motion ────────────────────────────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
      /* Expressive ambience — no state depends on it, so it simply stops. */
      .core-aura,
      .stage-bloom {
        animation: none;
      }
      .legend-row:hover {
        transform: none;
      }
      .legend-row,
      .ring {
        transition:
          border-color var(--duration-xs) linear,
          box-shadow var(--duration-xs) linear;
      }
      /*
       * The dot still marks the selected ring — it just parks at twelve o'clock,
       * on the ring's own index tick, instead of lapping it. A wake only makes
       * sense behind something that is moving.
       */
      .orbit-dot {
        animation: none;
        transform: translateY(calc(var(--r) * -1));
      }
      .orbit-dot::before {
        display: none;
      }
      /* The rings still resize — they have to, the detail needs the room — it just
         happens instantly rather than gliding. Both halves of each pair, since a
         focused-state rule would otherwise put its own transition back. */
      .tunnel-zone,
      .tunnel-zone-compact,
      .source-wrap,
      .source-wrap-collapsed {
        transition: none;
      }
      .pane-body {
        animation: none;
      }
      .legend-row:hover .legend-chevron {
        transform: none;
      }
      .example-toggle-chevron {
        transition: none;
      }
      /*
       * Expand/collapse is essential motion, not expressive: the height change is
       * what stops the opened content teleporting into place and shoving the rest
       * of the pane down. So it keeps its transition and only softens the curve —
       * and it has to keep running, since its own transitionend is what clears the
       * inline height the transition is driven from.
       */
      .example-collapse-animating {
        transition-timing-function: var(--ease-low-accel);
      }
      .core {
        transition: box-shadow var(--duration-xs) linear;
      }
    }

    /* ── forced colors ─────────────────────────────────────────────────── */
    @media (forced-colors: active) {
      .stage-bloom,
      .core-aura,
      .orbit-dot::before {
        display: none;
      }
      .tunnel-hero {
        border: 1px solid CanvasText;
        background: Canvas;
      }
      .legend-row {
        forced-color-adjust: none;
        background: ButtonFace;
        color: ButtonText;
        border: 2px solid ButtonBorder;
        box-shadow: none;
      }
      .legend-row-core .legend-name,
      .legend-row-core .legend-count {
        color: ButtonText;
      }
      .nav-btn {
        forced-color-adjust: none;
        background: ButtonFace;
        color: ButtonText;
        border: 2px solid ButtonBorder;
      }
      .nav-btn:hover {
        background: Highlight;
        color: HighlightText;
      }
      .code-block,
      .item-list,
      .item-row {
        forced-color-adjust: none;
        background: Canvas;
        color: CanvasText;
        border: 1px solid CanvasText;
      }
      .detail-icon {
        forced-color-adjust: none;
        background: Canvas;
        color: CanvasText;
        border: 1px solid CanvasText;
      }
      .legend-row:hover {
        background: Highlight;
        color: HighlightText;
        border-color: Highlight;
      }
      .legend-row:focus-visible {
        outline: 2px solid Highlight;
        outline-offset: 2px;
      }
      .legend-row-active,
      .legend-row[aria-selected='true'] {
        background: SelectedItem;
        color: SelectedItemText;
        border-color: ButtonBorder;
      }
      .legend-dot {
        forced-color-adjust: none;
      }
      .ring {
        border-color: CanvasText;
        box-shadow: none;
      }
      .orbit-dot {
        forced-color-adjust: none;
        background: CanvasText;
        box-shadow: none;
      }
      .core {
        forced-color-adjust: none;
        background: Canvas;
        border: 2px solid CanvasText;
        box-shadow: none;
      }
      .core-num,
      .core-label,
      .core-unit {
        color: CanvasText;
      }
      .score-track,
      .source-card {
        forced-color-adjust: none;
        background: Canvas;
        color: CanvasText;
        border: 1px solid CanvasText;
      }
      .score-value,
      .score-value-raw,
      .score-value-mid,
      .score-value-final,
      .detail-title,
      .detail-desc,
      .item-text,
      .example-caption,
      .example-empty {
        color: CanvasText;
      }
      .article-select-wrap,
      .example-empty {
        forced-color-adjust: none;
        background: Canvas;
        border: 1px solid CanvasText;
      }
      /* A gradient is not a colour forced-colors can honour, and the clamp is
         already announced by the control underneath it. */
      .example-collapse-clamped::after {
        display: none;
      }
      .example-toggle {
        forced-color-adjust: none;
        background: ButtonFace;
        color: ButtonText;
        border: 2px solid ButtonBorder;
      }
      .example-toggle:hover {
        background: Highlight;
        color: HighlightText;
        border-color: Highlight;
      }
      .example-toggle:focus-visible {
        outline: 2px solid Highlight;
        outline-offset: 2px;
      }
      .article-select {
        forced-color-adjust: auto;
        color: CanvasText;
      }
    }
  `;

  _stageCount(stage) {
    return stage ? stage.count : 0;
  }

  _select(id) {
    this.dispatchEvent(
      new CustomEvent('pipeline-tunnel:stage-select', {
        detail: {id},
        bubbles: true,
        composed: true
      })
    );
  }

  _handleArticleChange(e) {
    this.dispatchEvent(
      new CustomEvent('pipeline-tunnel:article-select', {
        detail: {id: e.target.value},
        bubbles: true,
        composed: true
      })
    );
  }

  _handleRowClick(id) {
    this._pendingFocus = {mode: 'detail'};
    this._select(id);
  }

  _handleToggleExample() {
    void this._toggleExample();
  }

  /**
   * Opens or closes the example, animating between the two heights. Both ends have
   * to be measured off the real DOM rather than assumed: the closed height is
   * whatever the clamp's own `flex: 1 1 0` resolved to in the space the pane had
   * left, and the open one is the content's. So this measures the current height,
   * lets Lit render the new state, measures again, and only then transitions
   * between the two — the render in the middle is why it has to await its own
   * update rather than doing this all in one pass.
   */
  async _toggleExample() {
    const before = this.renderRoot.querySelector('.example-collapse');
    const expanding = !this._expanded;
    if (!before) {
      this._expanded = expanding;
      return;
    }

    const from = before.getBoundingClientRect().height;
    // Set before the state change, so neither the update it triggers nor the one
    // `_exampleOverflows` may trigger after it re-measures a mid-transition height.
    this._animatingExample = true;
    this._expanded = expanding;
    await this.updateComplete;

    // Re-queried rather than reused: `keyed` on the stage id means the node can
    // have been replaced outright while this was awaiting.
    const el = this.renderRoot.querySelector('.example-collapse');
    const to = el ? el.getBoundingClientRect().height : from;
    if (!el || Math.abs(to - from) < 1) {
      this._settleExampleAnimation(el);
      return;
    }
    this._runExampleHeightTransition(el, from, to, expanding);
  }

  _runExampleHeightTransition(el, from, to, expanding) {
    el.classList.add('example-collapse-animating');
    if (!expanding) el.classList.add('example-collapse-animating-out');

    el.style.height = `${from}px`;
    // Read the layout back, so the browser commits `from` as a real start value
    // instead of coalescing both writes into one change with nothing between them.
    void el.offsetHeight;
    el.style.height = `${to}px`;

    const onEnd = e => {
      if (e.target !== el || e.propertyName !== 'height') return;
      el.removeEventListener('transitionend', onEnd);
      this._settleExampleAnimation(el);
    };
    el.addEventListener('transitionend', onEnd);

    clearTimeout(this._exampleAnimTimer);
    this._exampleAnimTimer = setTimeout(() => {
      el.removeEventListener('transitionend', onEnd);
      this._settleExampleAnimation(el);
    }, EXAMPLE_ANIM_TIMEOUT_MS);
  }

  /** Hands the height back to CSS and re-checks whether the clamp still clamps. */
  _settleExampleAnimation(el) {
    clearTimeout(this._exampleAnimTimer);
    this._exampleAnimTimer = 0;
    if (el) {
      el.style.height = '';
      el.classList.remove(
        'example-collapse-animating',
        'example-collapse-animating-out'
      );
    }
    this._animatingExample = false;
    this._measureExample();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._exampleAnimTimer);
  }

  /**
   * Every state opens closed, so the pane's height doesn't inherit whatever the last
   * one was left at. `selected` is owned by the host, and the article selector swaps
   * the example's content underneath an unchanged selection — both have to reset.
   */
  willUpdate(changed) {
    super.willUpdate?.(changed);
    if (changed.has('selected') || changed.has('selectedArticleId')) {
      this._expanded = false;
      this._exampleOverflows = false;
    }
  }

  _handleBackClick(fromId) {
    this._pendingFocus = {mode: 'list', id: fromId};
    this._select('');
  }

  /**
   * Steps to the next state on the path. Focus goes back to the Next control rather
   * than to the pane, so a keyboard user can walk the whole path without re-finding
   * the button after every step.
   */
  _handleNextClick(id) {
    this._pendingFocus = {mode: 'next'};
    this._select(id);
  }

  /**
   * Hands focus to whatever just replaced what the user was on. Deliberately does not
   * clear `_pendingFocus` until the target exists: `selected` is owned by the host, so
   * the update that renders the new pane is a later one than the click.
   */
  updated() {
    this._measureExample();

    const pending = this._pendingFocus;
    if (!pending) return;
    const el =
      pending.mode === 'detail'
        ? this.renderRoot.querySelector('.nav-btn')
        : pending.mode === 'next'
          ? // Falls back to the back control on the last state, which has no Next.
            (this.renderRoot.querySelector('.nav-btn-next') ??
            this.renderRoot.querySelector('.nav-btn'))
          : this.renderRoot.querySelector(`[data-stage="${pending.id}"]`);
    if (!el) return;
    this._pendingFocus = null;
    el.focus();
  }

  /**
   * Decides whether the "More" control is worth showing, by asking the clamped region
   * whether it is actually clamping anything. Only ever measured while closed and
   * settled — open, scrollHeight and clientHeight agree by definition, and
   * mid-transition it is the inline height driving the animation that would be
   * read; either concludes there is nothing to collapse and drops the control out
   * from under the reader.
   *
   * Assigning the same value back is a no-op for Lit's own dirty check, so this
   * settles after one extra update rather than looping.
   */
  _measureExample() {
    if (this._expanded || this._animatingExample) return;
    const el = this.renderRoot.querySelector('.example-collapse');
    this._exampleOverflows = el ? el.scrollHeight > el.clientHeight + 2 : false;
  }

  /** One hairline ring, sized off its own RING_DIAMETER entry. */
  _renderRing(stage) {
    return html`
      <div
        data-ring=${stage.ringIndex}
        style="--d:${RING_DIAMETER[stage.ringIndex]}cqw"
        class=${classMap({
          ring: true,
          [`ring-${stage.ringIndex}`]: true,
          'ring-active': this.selected === stage.id
        })}
      ></div>
    `;
  }

  /**
   * The single dot riding the selected state's ring. Rendered only for a selected
   * `ring` stage — the core is the end of the path and has no hairline to ride, and at
   * rest nothing is selected, so the field is still.
   *
   * `keyed` on the stage id so moving the selection to another state tears the dot
   * down and builds a new one: the orbit is a CSS animation, and reusing the node
   * would carry its current position (and animation phase) onto the next ring instead
   * of starting the new lap at twelve o'clock.
   *
   * Decorative — which state is selected is already carried by the legend row's own
   * pressed state and the detail pane that replaces the list, so this is aria-hidden.
   */
  _renderOrbitDot(stage) {
    if (!stage || stage.kind !== 'ring') return nothing;
    const tint = RING_TINT[stage.ringIndex] ?? RING_TINT[1];
    return keyed(
      stage.id,
      html`<span
        class="orbit-dot"
        aria-hidden="true"
        style=${styleMap({
          '--r': `${RING_DIAMETER[stage.ringIndex] / 2}cqw`,
          '--orbit-ms': `${ORBIT_MS}ms`,
          '--orb-body': tint.body,
          '--orb-tint': tint.tint
        })}
      ></span>`
    );
  }

  /**
   * The ring's index, sitting on its hairline at twelve o'clock. Derived from the same
   * RING_DIAMETER entry the ring itself is sized from: a ring of diameter D% has its
   * top edge (100 - D) / 2 in from the stage edge.
   */
  _renderRingTick(stage) {
    const inset = (100 - RING_DIAMETER[stage.ringIndex]) / 2;
    return html`
      <span
        aria-hidden="true"
        style="--tick-inset: ${inset}cqw"
        class=${classMap({
          'ring-tick': true,
          'ring-tick-active': this.selected === stage.id
        })}
        >${String(stage.ringIndex).padStart(2, '0')}</span
      >
    `;
  }

  /** The source node the demo feeds from — the dots' own travel is what connects it. */
  _renderSource(collapsed) {
    const src = this.source;
    if (!src) return nothing;
    return html`
      <div
        class=${classMap({
          'source-wrap': true,
          'source-wrap-collapsed': collapsed
        })}
        aria-hidden=${collapsed ? 'true' : 'false'}
      >
        <div class="source-card">
          <div class="sheets" aria-hidden="true">
            <span class="sheet sheet-back"></span>
            <span class="sheet sheet-front">
              <span class="sheet-line sheet-line-head"></span>
              <span class="sheet-line sheet-line-full"></span>
              <span class="sheet-line sheet-line-short"></span>
              <span class="sheet-line sheet-line-mid"></span>
            </span>
          </div>
          <span class="node-kicker">${src.kicker}</span>
          <span class="node-name">${src.name}</span>
          <span class="node-desc">${src.desc}</span>
          <span class="node-count">
            <span class="node-count-value">${src.count}</span>
            <span class="node-count-unit">${src.unit}</span>
          </span>
        </div>
      </div>
    `;
  }

  /** One row of the resting list. Opens that state's detail in place of the list. */
  _renderStageRow(stage, dotClass, ordinal) {
    return html`
      <li>
        <button
          type="button"
          data-stage=${stage.id}
          class=${classMap({
            'legend-row': true,
            'legend-row-core': stage.kind === 'core'
          })}
          @click=${() => this._handleRowClick(stage.id)}
        >
          <span class="legend-index" aria-hidden="true"
            >${String(ordinal).padStart(2, '0')}</span
          >
          <span class="legend-dot ${dotClass}" aria-hidden="true"></span>
          <span class="legend-text">
            <span class="legend-name">${stage.name}</span>
            <span class="legend-meta">${stage.sub}</span>
          </span>
          <span class="legend-count">${this._stageCount(stage)}</span>
          <span class="legend-chevron" aria-hidden="true">
            ${icon({name: 'chevron-right', size: 'xs'})}
          </span>
        </button>
      </li>
    `;
  }

  _renderStageList(pathStages) {
    return html`
      <ul class="legend-list">
        ${pathStages.map((stage, i) =>
          this._renderStageRow(stage, `dot-${i + 1}`, i + 1)
        )}
      </ul>
    `;
  }

  /** One side of the in/out pair — a code sample, or a set of labelled values. */
  _renderExampleSide(side, dir) {
    if (!side) return nothing;
    return html`
      <div class="example-col example-col-${dir}">
        <span class="example-label">${side.label}</span>
        ${side.kind === 'code'
          ? html`<pre class="code-block"><code
                >${side.lines.join('\n')}</code
              ></pre>`
          : html`
              <div class="item-list">
                ${side.items.map(
                  item => html`
                    <div class="item-row">
                      <span class="item-label">${item.label}</span>
                      <span class="item-text">${item.text}</span>
                    </div>
                  `
                )}
              </div>
            `}
        ${side.caption
          ? html`<span class="example-caption">${side.caption}</span>`
          : nothing}
      </div>
    `;
  }

  _renderExample(example) {
    if (!example) return nothing;
    return html`
      <div class="example-grid">
        ${this._renderExampleSide(example.in, 'in')}
        <span class="example-arrow" aria-hidden="true">
          ${icon({name: 'arrow-right', size: 'xs'})}
        </span>
        ${this._renderExampleSide(example.out, 'out')}
      </div>
    `;
  }

  /**
   * `next` is the following state on the path, or undefined on the last one — the core
   * is the end of the path, so there is nothing to step to and the control is simply
   * absent rather than present-but-dead.
   */
  _renderStageDetail(stage, ordinal, next) {
    const iconTone =
      stage.kind === 'core'
        ? 'detail-icon-core'
        : stage.tone === 'neutral'
          ? 'detail-icon-neutral'
          : '';
    return html`
      <div class="detail-region" role="region" aria-labelledby="lens-detail-title">
        <div class="detail-nav">
          <button
            type="button"
            class="nav-btn"
            @click=${() => this._handleBackClick(stage.id)}
          >
            ${icon({name: 'chevron-left', size: 'xs'})}
            <span>${i18n.getMessage('All states')}</span>
          </button>
          ${next
            ? html`
                <button
                  type="button"
                  class="nav-btn nav-btn-next"
                  @click=${() => this._handleNextClick(next.id)}
                >
                  <span
                    >${i18n.getMessage('Next · {state}', {
                      state: next.name
                    })}</span
                  >
                  ${icon({name: 'chevron-right', size: 'xs'})}
                </button>
              `
            : nothing}
        </div>
        <div class="detail-head">
          <span class="detail-icon ${iconTone}" aria-hidden="true">
            ${icon({name: stage.icon, size: 'sm'})}
          </span>
          <div>
            <span class="detail-eyebrow">
              ${i18n.getMessage('{n} · {sub}', {
                n: String(ordinal).padStart(2, '0'),
                sub: stage.sub
              })}
            </span>
            <h3 id="lens-detail-title" class="detail-title">${stage.name}</h3>
          </div>
        </div>
        <div class="detail-count">
          ${i18n.getMessage('{count} articles in this state', {
            count: String(this._stageCount(stage))
          })}
        </div>
        <p class="detail-desc">${stage.desc}</p>
        ${stage.example
          ? this._renderCollapsibleExample(stage.example)
          : stage.emptyMessage
            ? html`<p class="example-empty">${stage.emptyMessage}</p>`
            : nothing}
      </div>
    `;
  }

  /**
   * The in/out pair, clamped until asked for. `aria-hidden` is deliberately NOT set on
   * the clamped region: the overflow is visual, the whole example is still in the
   * accessibility tree, and hiding it would make the clamp a real content loss for a
   * screen-reader user rather than a layout choice.
   */
  _renderCollapsibleExample(example) {
    return html`
      <div
        id="lens-example"
        class=${classMap({
          'example-collapse': true,
          'example-collapse-clamped': !this._expanded
        })}
      >
        ${this._renderExample(example)}
      </div>
      ${this._exampleOverflows || this._expanded
        ? html`
            <button
              type="button"
              class=${classMap({
                'example-toggle': true,
                'example-toggle-open': this._expanded
              })}
              aria-expanded=${this._expanded ? 'true' : 'false'}
              aria-controls="lens-example"
              @click=${() => this._handleToggleExample()}
            >
              <span
                >${this._expanded
                  ? i18n.getMessage('Less')
                  : i18n.getMessage('More')}</span
              >
              <span class="example-toggle-chevron" aria-hidden="true">
                ${icon({name: 'chevron-down', size: 'xs'})}
              </span>
            </button>
          `
        : nothing}
    `;
  }

  /**
   * The mechanical score at each content stage. One rubric computed identically every
   * time, which is the whole reason these three numbers can sit next to each other.
   */
  _renderScoreTrack() {
    const steps = this.scoreTrack;
    if (!steps?.length) return nothing;
    return html`
      <div class="score-track">
        ${steps.map(
          (step, i) => html`
            ${i > 0
              ? html`<svg
                  width="20"
                  height="9"
                  viewBox="0 0 22 10"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M0 5h20m0 0-4-4m4 4-4 4"
                    stroke="#cfcecb"
                    stroke-width="1.3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>`
              : nothing}
            <span class="score-step">
              <span class="score-label">${step.label}</span>
              <span
                class=${classMap({
                  'score-value': true,
                  'score-value-raw': step.tone === 'raw',
                  'score-value-mid': step.tone === 'mid',
                  'score-value-final': step.tone === 'final'
                })}
                >${step.value}</span
              >
            </span>
          `
        )}
        ${this.scoreNote
          ? html`<span class="score-note">${this.scoreNote}</span>`
          : nothing}
      </div>
    `;
  }

  render() {
    const coreStage = this.stages.find(s => s.kind === 'core');
    const ringStages = this.stages.filter(s => s.kind === 'ring');
    // Ring states then the core form the numbered path.
    const pathStages = coreStage ? [...ringStages, coreStage] : ringStages;
    const focusedIndex = pathStages.findIndex(s => s.id === this.selected);
    const focused = focusedIndex >= 0 ? pathStages[focusedIndex] : null;

    return html`
      <section
        class="tunnel-hero"
        aria-label=${i18n.getMessage('Refining path')}
      >
        <div class="hero-controls">
          ${this.articles.length
            ? html`
                <label class="article-select-wrap">
                  <span class="article-select-label"
                    >${i18n.getMessage('KB Article')}</span
                  >
                  <select
                    class="article-select"
                    .value=${this.selectedArticleId}
                    @change=${e => this._handleArticleChange(e)}
                  >
                    ${this.articles.map(
                      article => html`<option value=${article.id}>${article.title}</option>`
                    )}
                  </select>
                </label>
              `
            : nothing}
          <div class="top-pill">
            <span class="top-pill-label">${i18n.getMessage('On the path')}</span>
            <span class="top-pill-value">${this.inFlight}</span>
          </div>
        </div>

        <div
          class="hero-row"
        >
          ${this._renderSource(!!focused)}

          <div
            class=${classMap({
              'tunnel-zone': true,
              'tunnel-zone-compact': !!focused
            })}
          >
            <div class="tunnel-stage">
              <div class="stage-bloom"></div>
              ${ringStages.map(stage => this._renderRing(stage))}
              ${ringStages.map(stage => this._renderRingTick(stage))}
              <div class="core-aura"></div>
              <div
                class=${classMap({
                  core: true,
                  'core-selected': this.selected === coreStage?.id
                })}
              >
                <span class="core-label">${i18n.getMessage('AI-ready KB')}</span>
                <span class="core-num">${this._stageCount(coreStage)}</span>
                <span class="core-unit">${i18n.getMessage('articles')}</span>
              </div>
              <!-- Last, so it paints over the core and its aura: the innermost
                   ring's radius sits close enough to the core's own edge that an
                   earlier dot would be clipped by it on part of every lap. -->
              ${this._renderOrbitDot(focused)}
            </div>
          </div>

          <div class="detail-pane">
            ${keyed(
              focused ? focused.id : 'all',
              html`<div class="pane-body">
                ${focused
                  ? this._renderStageDetail(
                      focused,
                      focusedIndex + 1,
                      pathStages[focusedIndex + 1]
                    )
                  : this._renderStageList(pathStages)}
              </div>`
            )}
          </div>
        </div>

        ${this._renderScoreTrack()}
      </section>
    `;
  }
}
