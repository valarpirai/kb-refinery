import {html, css, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {styleMap} from 'lit/directives/style-map.js';
import {classMap} from 'lit/directives/class-map.js';
import {AIUXElement, AMBController} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';
import {navigate} from '@servicenow/aiux/aiux-client';
import '@servicenow/aiux/aiux-components-score';
import {setDocumentTitle} from '../../utils/document-title.js';
import {JOB_TABLE, JOB_ITEM_TABLE, fetchCurrentJob, fetchJobStatus, fetchJobItemCounts} from './current-job.js';
import {fetchRecentAnalyses} from './analysis-list.js';
import '../../widgets/pipeline-run-launcher/index.js';
import '../../widgets/product-word-cloud/index.js';

/**
 * App-relative — `navigate()` prefixes the app's own base path itself (the
 * router tracks `currentPath` base-stripped), so this matches the nav item's
 * own `action.path` in application.js rather than a full pathname.
 */
const PIPELINE_PATH = '/pipeline';
const ANALYSIS_REPORT_PATH_PREFIX = '/analysis-report/';

/** Shown for a missing score in the recent-analyses table. */
const NO_VALUE = '—';

/**
 * The refining path, in order — the five real x_snc_kb_refinery_job_item
 * status values that are pipeline phases (deduplicating folds into
 * analyzing, and the rewrite + final re-score both fall under 'scoring' --
 * see refineryOrchestrator.server.js). `failed` is not a phase: it replaces
 * whichever phase was running, so the rail can't place it and handles it
 * separately. The rail's position is the plurality of in-flight Job Items
 * across the whole job, not a single Job.status field (which is coarse now
 * -- see current-job.js's fetchJobItemCounts) -- so it's a representative
 * "where's most of the work right now," not a literal single position.
 *
 * `body` paints the node; `tint` is the same hue as an rgb triplet, for the
 * active node's contact ring and bloom and for the travelling orb — the same
 * split the pipeline page's own orbs use.
 *
 * The ramp is that page's ripening ramp: raw at the head, AI-ready green at the
 * terminal. Its first two stops track the theme's own neutral rather than the
 * hero's fixed light-only greys (#cfcecb / #b6c4c1) — the hero is a deliberately
 * fixed art surface, but this card sits among themed cards and has to flip with
 * light/dark.
 */
const RAIL_STAGES = [
  {id: 'converting', body: 'var(--color-base-300)', tint: '168, 167, 164'},
  {
    id: 'analyzing',
    body: 'color-mix(in srgb, #00af9f 22%, var(--color-base-300))',
    tint: '152, 165, 162'
  },
  {id: 'enriching', body: '#2ab98c', tint: '42, 185, 140'},
  {id: 'scoring', body: '#00b271', tint: '0, 178, 113'},
  {id: 'completed', body: '#00b271', tint: '0, 178, 113'}
];

const LAST_STAGE_INDEX = RAIL_STAGES.length - 1;

/**
 * Kept out of RAIL_STAGES so each getMessage call runs per render rather than
 * once at module load — the same reason the pipeline page builds its own stage
 * list in a method instead of a module constant.
 */
function stageLabel(id) {
  switch (id) {
    case 'converting':
      return i18n.getMessage('Converting');
    case 'analyzing':
      return i18n.getMessage('Analyzing');
    case 'enriching':
      return i18n.getMessage('Enriching');
    case 'scoring':
      return i18n.getMessage('Scoring');
    default:
      return i18n.getMessage('Completed');
  }
}

/**
 * Picks a single representative rail position from real per-article status
 * counts: the earliest (lowest-index) in-flight stage that still has any
 * articles in it -- the "leading edge" the job as a whole hasn't cleared
 * yet. Returns -1 when nothing is in flight (nothing started, or everything
 * already reached a terminal status).
 */
function stageIndexFromCounts(counts) {
  if (!counts) return -1;
  for (let i = 0; i < RAIL_STAGES.length - 1; i++) {
    if ((counts[RAIL_STAGES[i].id] || 0) > 0) return i;
  }
  return -1;
}

/** Health/readability score → badge tone. Thresholds match the pipeline's own QA bands. */
function scoreTone(score) {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'error';
}

@customElement('x-snc-kb-refinery-home-page')
export default class HomePage extends AIUXElement {
  // Layout, color, and spacing all come from DaisyUI components + Tailwind
  // utilities below; `static styles` is otherwise reserved for `:host`. The
  // forced-colors block is here because it has no utility-class equivalent.
  static styles = css`
    :host {
      display: block;
      min-height: 100%;
      container-type: inline-size;
    }

    /* ── refine call-to-action panel ────────────────────────────────────── */
    /*
     * The page's one primary action, so it reads as a surface rather than a
     * button on the page background: a faint primary-hue wash with a bloom in
     * the top-right corner, the same glow language the rail's nodes use.
     *
     * Flat token background declared first — a browser without color-mix()
     * drops every layer below it and would otherwise leave the panel
     * transparent against the page.
     */
    .cta-panel {
      background: var(--color-base-100);
      background:
        radial-gradient(
          120% 140% at 100% 0%,
          color-mix(in srgb, var(--color-primary) 14%, transparent) 0%,
          transparent 62%
        ),
        linear-gradient(
          135deg,
          color-mix(in srgb, var(--color-primary) 7%, var(--color-base-100)) 0%,
          var(--color-base-100) 58%
        );
      border: 1px solid
        color-mix(in srgb, var(--color-primary) 18%, var(--color-base-300));
    }

    /*
     * forced-colors replaces every author colour, which would flatten the wash
     * and the tinted border into one indistinguishable field — the panel's
     * boundary is restored explicitly (WCAG 1.4.1).
     */
    @media (forced-colors: active) {
      .cta-panel {
        background: Canvas;
        border-color: ButtonBorder;
      }
    }

    /* ── pipeline rail ──────────────────────────────────────────────────── */
    /*
     * A thin read of the refining path: six nodes, five connectors, and one
     * orb riding the segment the run is currently working. Node fill, the
     * active node's bloom, and the orb's body/wake all come from RAIL_STAGES'
     * ramp, so the rail ripens left to right exactly as the pipeline page's
     * orbs do as they fall inward.
     *
     * Its own container, so the label row can switch on the rail's width
     * rather than the page's (:host is a container too).
     */
    .rail {
      container-type: inline-size;
    }

    .rail-track {
      display: flex;
      align-items: center;
    }

    .rail-node {
      flex-shrink: 0;
      width: 11px;
      height: 11px;
      border-radius: 50%;
      background: var(--rail-body);
      transition: background-color var(--duration-md) linear;
    }

    /*
     * The terminal reads as the destination rather than one more stop, the way
     * the hero's core does — larger, with a contact ring in its own hue.
     */
    .rail-node--terminal {
      width: 14px;
      height: 14px;
      box-shadow: 0 0 0 3px rgba(var(--rail-tint), 0.16);
    }

    .rail-node--pending {
      background: var(--color-base-300);
      opacity: 0.55;
    }

    /*
     * The active node glows by being saturated against a desaturated field —
     * a tinted contact ring plus a soft bloom in its own hue, the same
     * treatment the travelling orbs get on the pipeline page.
     */
    .rail-node--active {
      width: 14px;
      height: 14px;
      box-shadow:
        0 0 0 3px rgba(var(--rail-tint), 0.14),
        0 0 16px 5px rgba(var(--rail-tint), 0.26);
      animation: rail-node-pulse 2.6s ease-in-out infinite;
    }

    .rail-node--failed {
      width: 14px;
      height: 14px;
      background: var(--color-error, #be0003);
      box-shadow: 0 0 0 3px rgba(190, 0, 3, 0.16);
    }

    .rail-link {
      position: relative;
      flex: 1;
      min-width: 8px;
      height: 2px;
      border-radius: 999px;
      background: var(--color-base-300);
    }

    /* Run segments carry the ramp itself, so the path is a gradient rather
       than a row of flat ticks. */
    .rail-link--run {
      background: linear-gradient(
        to right,
        var(--rail-from),
        var(--rail-to)
      );
    }

    .rail-link--pending {
      opacity: 0.55;
    }

    /*
     * The travelling orb: a glossy body with a specular highlight, a tinted
     * contact ring and a bloom, lifted from the hero's own orbs so the two
     * surfaces read as one system. The left offset animates rather than a
     * transform because the segment's width is only known at layout — the orb is
     * absolutely positioned, so nothing else reflows with it.
     */
    .rail-orb {
      position: absolute;
      top: 50%;
      left: 0;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      /* Flat hue first: a browser without color-mix() drops the gradient
         entirely, and an orb with only a box-shadow is an invisible orb. */
      background: var(--rail-body);
      background: radial-gradient(
        circle at 34% 30%,
        #ffffff 0%,
        color-mix(in srgb, var(--rail-body) 45%, #ffffff) 44%,
        var(--rail-body) 100%
      );
      box-shadow:
        0 0 0 3px rgba(var(--rail-tint), 0.14),
        0 0 14px 5px rgba(var(--rail-tint), 0.26);
      animation: rail-flow 2.8s var(--ease-low-accel) infinite;
      will-change: left;
    }

    /* Wake — trails the orb, thinning out behind it. */
    .rail-orb::before {
      content: '';
      position: absolute;
      top: 50%;
      right: 50%;
      width: 22px;
      height: 3px;
      transform: translateY(-50%);
      border-radius: 999px;
      filter: blur(1.5px);
      background: linear-gradient(
        to left,
        rgba(var(--rail-tint), 0.5) 0%,
        rgba(var(--rail-tint), 0.16) 45%,
        rgba(var(--rail-tint), 0) 100%
      );
    }

    @keyframes rail-flow {
      0% {
        left: 0%;
        opacity: 0;
      }
      12% {
        opacity: 1;
      }
      88% {
        opacity: 1;
      }
      100% {
        left: 100%;
        opacity: 0;
      }
    }

    @keyframes rail-node-pulse {
      0%,
      100% {
        box-shadow:
          0 0 0 3px rgba(var(--rail-tint), 0.14),
          0 0 16px 5px rgba(var(--rail-tint), 0.26);
      }
      50% {
        box-shadow:
          0 0 0 5px rgba(var(--rail-tint), 0.1),
          0 0 22px 7px rgba(var(--rail-tint), 0.16);
      }
    }

    /*
     * The per-stage labels only fit spelled out once the rail is wide enough;
     * below that the rail keeps its nodes and only the running stage is named,
     * so nothing has to scroll sideways (WCAG 1.4.10).
     *
     * Both display values live here rather than coming from a Tailwind block /
     * hidden utility, so the toggle can't lose to .block — the utility
     * sheet and this one are separate adopted stylesheets at equal
     * specificity, and which of them wins on source order isn't a thing to
     * bet a layout on.
     */
    .rail-labels {
      display: none;
    }
    .rail-caption {
      display: block;
    }
    @container (min-width: 520px) {
      .rail-labels {
        display: flex;
      }
      .rail-caption {
        display: none;
      }
    }

    /*
     * Expressive, not essential: the rail's state is carried by node fill and
     * size, so the flow and the pulse are emphasis and reduce to nothing. The
     * orb stays, parked mid-segment, because *where* the work is remains real
     * information.
     */
    @media (prefers-reduced-motion: reduce) {
      .rail-node--active,
      .rail-orb {
        animation: none;
      }
      .rail-orb {
        left: 50%;
      }
      .rail-orb::before {
        display: none;
      }
    }

    /*
     * The rail is built entirely from author colours, which forced-colors
     * replaces wholesale — every node and segment would collapse to one
     * indistinguishable colour. Setting forced-color-adjust:none on the rail
     * keeps the ramp intact, and is safe here because the rail is this page's own
     * markup with no component nested inside it to inherit the override.
     *
     * The clickable card is styled only by its hover shadow and border tint,
     * both also dropped, so its boundary is restored explicitly (WCAG 1.4.1)
     * with Highlight for keyboard focus (2.4.7).
     */
    @media (forced-colors: active) {
      .rail-track {
        forced-color-adjust: none;
      }
      .pipeline-card {
        border-color: ButtonBorder;
      }
      .pipeline-card:focus-visible {
        outline: 3px solid Highlight;
        outline-offset: 2px;
      }
    }
  `;

  /** The run the rail draws, its coarse status, and its real per-article counts. */
  @state() _jobSysId = '';
  @state() _jobStatus = '';
  @state() _itemCounts = null;

  /** Set when the lookup itself failed — distinct from "no runs exist yet". */
  @state() _jobLookupFailed = false;

  /** Recent Analysis records for the "Articles" list below — see analysis-list.js. */
  @state() _analyses = [];
  @state() _analysesLoading = true;
  @state() _analysesFailed = false;

  /**
   * Whether the lookup has finished. Its own flag because a resolved `''` (no
   * runs on the table) and a not-yet-resolved `''` draw differently: the first
   * is named, the second is just an unlit rail.
   */
  @state() _jobResolved = false;

  /**
   * Keeps the rail current: the run advances through its phases server-side, so
   * without a watcher the rail would be a snapshot from page load.
   */
  _amb = new AMBController(this);

  /**
   * Deliberately firstUpdated() and not connectedCallback(): the latter also
   * runs during SSR, and an async fetch resolving there can race client
   * hydration into a duplicated, un-hydrated render (see
   * widget-and-page-conventions.md).
   */
  async firstUpdated() {
    setDocumentTitle(i18n.getMessage('Dashboard'));
    void this._loadAnalyses();
    try {
      const job = await fetchCurrentJob();
      this._jobSysId = job?.sysId ?? '';
      this._jobStatus = job?.status ?? '';
      this._jobResolved = true;
      if (this._jobSysId) {
        this._itemCounts = await fetchJobItemCounts(this._jobSysId).catch(() => null);
        this._amb.setRecordWatchers(
          [
            {table: JOB_TABLE, query: `sys_id=${this._jobSysId}`},
            {table: JOB_ITEM_TABLE, query: `job=${this._jobSysId}`}
          ],
          this._handleJobChange
        );
      }
    } catch (e) {
      this._jobLookupFailed = true;
    }
  }

  async _loadAnalyses() {
    try {
      this._analyses = await fetchRecentAnalyses();
    } catch (e) {
      this._analysesFailed = true;
    } finally {
      this._analysesLoading = false;
    }
  }

  /**
   * Pre-bound, and re-reads rather than parsing the message: the record-watcher
   * payload isn't guaranteed to carry `status`, so a message is only a signal
   * that something moved.
   */
  _handleJobChange = async () => {
    if (!this._jobSysId) return;
    const sysId = this._jobSysId;
    try {
      const [status, itemCounts] = await Promise.all([
        fetchJobStatus(sysId),
        fetchJobItemCounts(sysId)
      ]);
      // The run can't change under us here, but the guard costs nothing and
      // keeps a slow response from overwriting a newer one.
      if (this._jobSysId === sysId) {
        this._jobStatus = status;
        this._itemCounts = itemCounts;
      }
    } catch (e) {
      // A dropped refresh just leaves the last known phase on screen; the next
      // message retries. Not worth tearing the rail down over.
    }
  };

  _openPipeline() {
    void navigate(PIPELINE_PATH);
  }

  /**
   * The launcher already created the job and knows its sys_id — no need to
   * wait for fetchCurrentJob()/the next AMB tick to pick it up. Same
   * subscribe call firstUpdated() makes, just re-pointed at the new run.
   *
   * Immediately navigates to the pipeline page too: fetchCurrentJob() there
   * resolves to "the most recent in-flight job," and the run just started is
   * always exactly that (freshly created, status running) — no query param
   * needed to point it at the right job.
   */
  _handleRunStarted = e => {
    const sysId = e.detail?.jobSysId ?? '';
    if (!sysId) return;
    this._jobSysId = sysId;
    this._jobStatus = 'running';
    this._itemCounts = null;
    this._jobResolved = true;
    this._jobLookupFailed = false;
    this._amb.setRecordWatchers(
      [
        {table: JOB_TABLE, query: `sys_id=${sysId}`},
        {table: JOB_ITEM_TABLE, query: `job=${sysId}`}
      ],
      this._handleJobChange
    );
    void navigate(PIPELINE_PATH);
  };

  /**
   * The page's one primary action, given a surface of its own rather than a
   * small button floated above the rail card: a tinted panel carrying the same
   * primary-hue bloom language the rail's own nodes and orb use.
   *
   * The button itself lives inside <pipeline-run-launcher> (it owns the picker
   * and the server calls), so its premium treatment has to be in that widget's
   * own shadow root — this panel only provides the surface and the copy.
   */
  _renderRefineCta() {
    return html`
      <div
        class="cta-panel flex flex-col justify-between gap-5 rounded-[var(--radius-box)]
               p-6 shadow-sm lg:col-span-2 lg:flex-row lg:items-center"
      >
        <div class="min-w-0">
          <p
            class="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary"
          >
            ${i18n.getMessage('Refine on demand')}
          </p>
          <h2 class="mt-1.5 text-xl font-bold tracking-tight text-text-primary">
            ${i18n.getMessage('Refine articles')}
          </h2>
          <p class="mt-1.5 max-w-md text-sm leading-relaxed text-text-secondary">
            ${i18n.getMessage(
              'Pick knowledge articles and send them through the refinery now, instead of waiting for the next scheduled batch.'
            )}
          </p>
        </div>
        <div class="flex-shrink-0">
          <pipeline-run-launcher
            @pipeline-run-launcher:started=${this._handleRunStarted}
          ></pipeline-run-launcher>
        </div>
      </div>
    `;
  }

  /**
   * A thin read of the refining path, sitting directly below the refine action:
   * five nodes, four connectors, and one orb riding the segment the run is
   * currently working. The orb's position is the leading edge of real
   * per-article progress (stageIndexFromCounts), not a single Job.status
   * phase — Job.status is coarse now (pending/running/completed/
   * completed_with_errors/failed).
   *
   * The whole card is the button. With only the rail inside it there is no
   * content worth keeping separately navigable, so collapsing it into one
   * control is both simpler and shorter than a labelled link beside it — and
   * it means the affordance is a chevron rather than a line of copy.
   *
   * The title takes the pipeline page's own label treatment (its
   * .detail-eyebrow and the tunnel's top pills): mono, 10px, 600, 0.1em
   * tracking, uppercase, dim. Kept dim deliberately, so the running stage
   * below stays the card's only strong text.
   */
  _renderPipelineCard() {
    // A finished job (clean or mixed) is drawn idle, same as never having
    // run -- otherwise the rail reports the *last* finished run as if it
    // were still in flight. Only a pure 'failed' run gets the terminal
    // failed treatment; 'completed_with_errors' still finished, so it's
    // idle too (the pipeline/job-tracker pages are where its errors show).
    const isIdle =
      !this._jobStatus || this._jobStatus === 'completed' || this._jobStatus === 'completed_with_errors';
    const stageIndex = isIdle ? -1 : stageIndexFromCounts(this._itemCounts);
    const failed = this._jobStatus === 'failed';
    // Set only when there is no phase to draw, and then it is the one thing
    // the card says.
    const note = this._jobLookupFailed
      ? i18n.getMessage('Unavailable')
      : failed
        ? i18n.getMessage('Failed')
        : isIdle
          ? this._jobResolved && this._jobSysId
            ? i18n.getMessage('No pipeline currently running')
            : i18n.getMessage('No runs yet')
          : '';

    return html`
      <button
        type="button"
        class="pipeline-card group/card block w-full cursor-pointer
               rounded-[var(--radius-box)] border border-transparent bg-base-100
               p-5 text-left shadow-sm
               [transition:box-shadow_var(--duration-sm)_var(--ease-medium-accel),border-color_var(--duration-sm)_linear]
               hover:border-primary hover:shadow-md
               focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary
               motion-reduce:[transition:box-shadow_var(--duration-xs)_linear,border-color_var(--duration-xs)_linear]"
        aria-label=${i18n.getMessage('Open the Knowledge Refinery pipeline')}
        @click=${this._openPipeline}
      >
        <span class="mb-3 flex items-center justify-between gap-2">
          <span
            class="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary"
          >
            ${i18n.getMessage('Knowledge Refinery')}
          </span>
          <span
            class="text-text-tertiary transition-transform duration-[var(--duration-sm)]
                   [transition-timing-function:var(--ease-medium-accel)]
                   group-hover/card:translate-x-0.5
                   motion-reduce:translate-x-0 motion-reduce:transition-none"
            aria-hidden="true"
          >
            ${icon({name: 'chevron-right', size: 'sm'})}
          </span>
        </span>

        <span class="rail block">
          ${this._renderRailTrack(stageIndex, failed)}
          ${note
            ? html`<span class="mt-2.5 block text-[11px] text-text-tertiary">
                ${note}
              </span>`
            : html`
                ${this._renderRailLabels(stageIndex)}
                <span
                  class="rail-caption mt-2.5 text-[11px] font-semibold text-text-primary"
                >
                  ${stageIndex >= 0
                    ? stageLabel(RAIL_STAGES[stageIndex].id)
                    : nothing}
                </span>
              `}
          <span class="sr-only" role="status">
            ${note
              ? note
              : stageIndex >= 0
                ? i18n.getMessage('Pipeline stage: {stage}', {
                    stage: stageLabel(RAIL_STAGES[stageIndex].id)
                  })
                : nothing}
          </span>
        </span>
      </button>
    `;
  }

  /**
   * Nodes and connectors interleaved. `aria-hidden` throughout — it is a
   * visualization of one value, and that value is carried as text by the
   * status region alongside it.
   */
  _renderRailTrack(stageIndex, failed) {
    // The orb rides the segment leaving the running node, so it reads as work
    // moving on rather than sitting still. Nothing to ride at the terminal.
    const flowIndex =
      !failed && stageIndex >= 0 && stageIndex < LAST_STAGE_INDEX
        ? stageIndex
        : -1;

    const parts = [];
    RAIL_STAGES.forEach((stage, i) => {
      if (i > 0) parts.push(this._renderRailLink(i - 1, stageIndex, flowIndex));
      parts.push(this._renderRailNode(stage, i, stageIndex, failed));
    });
    return html`<span class="rail-track" aria-hidden="true">${parts}</span>`;
  }

  _renderRailNode(stage, index, stageIndex, failed) {
    const terminal = index === LAST_STAGE_INDEX;
    // A failed run loses which phase it was in, so the rail can only mark the
    // outcome — the terminal goes red and every node behind it stays unlit.
    if (failed) {
      return terminal
        ? html`<span class="rail-node rail-node--failed"></span>`
        : html`<span class="rail-node rail-node--pending"></span>`;
    }

    const done = stageIndex >= 0 && index < stageIndex;
    const active = index === stageIndex;
    const pending = !done && !active;
    return html`<span
      class=${classMap({
        'rail-node': true,
        'rail-node--terminal': terminal && !pending,
        'rail-node--active': active,
        'rail-node--pending': pending
      })}
      style=${styleMap({'--rail-body': stage.body, '--rail-tint': stage.tint})}
    ></span>`;
  }

  _renderRailLink(segIndex, stageIndex, flowIndex) {
    const from = RAIL_STAGES[segIndex];
    const to = RAIL_STAGES[segIndex + 1];
    const run = segIndex < stageIndex;
    const flow = segIndex === flowIndex;
    return html`<span
      class=${classMap({
        'rail-link': true,
        'rail-link--run': run,
        'rail-link--pending': !run && !flow
      })}
      style=${styleMap({'--rail-from': from.body, '--rail-to': to.body})}
    >
      ${flow
        ? html`<span
            class="rail-orb"
            style=${styleMap({'--rail-body': from.body, '--rail-tint': from.tint})}
          ></span>`
        : nothing}
    </span>`;
  }

  /** Only rendered above the rail's own container breakpoint — see .rail-labels. */
  _renderRailLabels(stageIndex) {
    return html`<span class="rail-labels mt-2.5 gap-1" aria-hidden="true">
      ${RAIL_STAGES.map(
        (stage, i) => html`<span
          class=${classMap({
            'min-w-0': true,
            'flex-1': true,
            truncate: true,
            'text-[11px]': true,
            'leading-tight': true,
            'text-left': i === 0,
            'text-center': i > 0 && i < LAST_STAGE_INDEX,
            'text-right': i === LAST_STAGE_INDEX,
            'font-semibold': i === stageIndex,
            'text-text-primary': i === stageIndex,
            'text-text-tertiary': i !== stageIndex
          })}
          >${stageLabel(stage.id)}</span
        >`
      )}
    </span>`;
  }

  /**
   * The one KPI this page still shows. The health / AI-readability tiles and
   * their two distribution cards were removed deliberately — every one of them
   * was hardcoded demo data, and the page's real content (the rail, the recent-
   * analyses table) carries actual records.
   */
  _totalArticlesKpi() {
    return {
      label: i18n.getMessage('Total articles'),
      value: 1248,
      formattedValue: '1,248',
      sentiment: 'positive',
      change: {
        value: 18,
        formattedValue: i18n.getMessage('+18'),
        isPercentage: false,
        reference: i18n.getMessage('added this week')
      }
    };
  }

  /** Analysis.pipeline_stage -> badge tone. 'ready' is the only unambiguous success state. */
  _pipelineStageTone(stage) {
    if (stage === 'ready') return 'success';
    if (stage === 'failed') return 'error';
    return 'info';
  }

  render() {
    return html`
      <div class="mx-auto flex max-w-7xl flex-col gap-6 p-4 lg:p-8">
        <div>
          <p class="font-mono text-xs font-bold uppercase tracking-wide text-primary">
            ${i18n.getMessage('Knowledge base status')}
          </p>
          <h1 class="mt-1 text-3xl font-bold tracking-tight text-text-primary">
            ${i18n.getMessage('Knowledge base health')}
          </h1>
          <p class="mt-1.5 max-w-xl text-sm leading-relaxed text-text-secondary">
            ${i18n.getMessage(
              'Live health and AI-readiness across {count} knowledge articles.',
              {count: '1,248'}
            )}
          </p>
        </div>

        <div class="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
          <aiux-score size="sm" .data=${this._totalArticlesKpi()}></aiux-score>
          ${this._renderRefineCta()}
        </div>

        ${this._renderPipelineCard()}

        <product-word-cloud></product-word-cloud>

        <div class="aiux-card bg-base-100 shadow-sm">
          <div class="aiux-card-body gap-4 p-0">
            <div class="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
              <h3 class="aiux-card-title text-base text-text-primary">
                ${i18n.getMessage('Recent analyses')}
              </h3>
            </div>
            ${this._renderAnalysesTable()}
            <div class="h-2"></div>
          </div>
        </div>
      </div>
    `;
  }

  /** Real "recent analyses" table -- clicking a title opens its analysis report page. */
  _renderAnalysesTable() {
    if (this._analysesLoading) {
      return html`<p class="px-6 py-5 text-sm text-text-tertiary">${i18n.getMessage('Loading…')}</p>`;
    }
    if (this._analysesFailed) {
      return html`
        <p class="px-6 py-5 text-sm text-text-tertiary">
          ${i18n.getMessage("Couldn't load recent analyses.")}
        </p>
      `;
    }
    if (!this._analyses.length) {
      return html`
        <p class="px-6 py-5 text-sm text-text-tertiary">${i18n.getMessage('No analyses yet.')}</p>
      `;
    }
    return html`
      <div class="overflow-x-auto">
        <table class="aiux-table">
          <thead>
            <tr>
              <th scope="col" class="w-[40%]">${i18n.getMessage('Article')}</th>
              <th scope="col">${i18n.getMessage('Health')}</th>
              <th scope="col">${i18n.getMessage('AI readability')}</th>
              <th scope="col">${i18n.getMessage('Status')}</th>
              <th scope="col">${i18n.getMessage('Updated')}</th>
            </tr>
          </thead>
          <tbody>
            ${this._analyses.map(
              analysis => html`
                <tr>
                  <td>
                    <button
                      type="button"
                      class="aiux-link aiux-link-hover aiux-link-primary text-left text-sm font-semibold"
                      @click=${() => navigate(`${ANALYSIS_REPORT_PATH_PREFIX}${analysis.sysId}`)}
                    >
                      ${analysis.title || i18n.getMessage('Untitled analysis')}
                    </button>
                  </td>
                  <td>
                    ${typeof analysis.score === 'number'
                      ? html`
                          <span class="aiux-badge aiux-badge-sm aiux-badge-${scoreTone(analysis.score)} aiux-badge-soft">
                            ${analysis.score}
                          </span>
                        `
                      : html`<span class="text-xs text-text-tertiary">${NO_VALUE}</span>`}
                  </td>
                  <td>
                    ${typeof analysis.llmScore === 'number'
                      ? html`
                          <span class="aiux-badge aiux-badge-sm aiux-badge-${scoreTone(analysis.llmScore)} aiux-badge-soft">
                            ${analysis.llmScore}
                          </span>
                        `
                      : html`<span class="text-xs text-text-tertiary">${NO_VALUE}</span>`}
                  </td>
                  <td>
                    <span
                      class="aiux-badge aiux-badge-sm aiux-badge-${this._pipelineStageTone(
                        analysis.pipelineStage
                      )} aiux-badge-soft"
                    >
                      ${analysis.pipelineStageLabel || analysis.pipelineStage}
                    </span>
                  </td>
                  <td class="text-xs text-text-tertiary">${analysis.updatedOn || NO_VALUE}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }
}
