import {html, css} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {AIUXElement, AMBController} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {navigate} from '@servicenow/aiux/aiux-client';
import '@servicenow/aiux/aiux-components-score';
import '@servicenow/aiux/aiux-components-list';
import './components/pipeline-tunnel.js';
import {setDocumentTitle} from '../../utils/document-title.js';
import {
  JOB_TABLE,
  JOB_ITEM_TABLE,
  fetchCurrentJob,
  fetchPipelineOverview,
  fetchArticleDetail,
  pickDefaultArticleId
} from './pipeline-data.js';

const ANALYSIS_REPORT_PATH_PREFIX = '/analysis-report/';

/**
 * Shown before the first real fetch resolves, and whenever no job has ever
 * run -- every count is real 0, not a placeholder.
 */
const EMPTY_OVERVIEW = {
  stageCounts: {
    ingested: 0,
    converted: 0,
    analyzed: 0,
    enriching: 0,
      ready: 0,
    no_gaps: 0,
    no_evidence: 0,
    failed: 0,
    skipped: 0
  },
  stats: {onPath: 0, ready: 0, awaitingCallback: 0, leftEarly: 0},
  sourceCount: 0,
  scoreTrack: {raw: null, converted: null, enriched: null},
  articles: []
};

/**
 * Ring stage ids in path order, mirroring pipeline-data.js's own STAGE_ORDER. Four
 * on-path steps, not five: the Call 3 rewrite and its re-score have no ring of their
 * own and bucket into `enriching` instead — see pipeline-data.js's
 * ITEM_STATUS_TO_STAGE, and refineryOrchestrator.server.js for the phase itself.
 * Used only to compute each ring's live fill fraction — see `_ringProgress`.
 */
const RING_STAGE_IDS = ['ingested', 'converted', 'analyzed', 'enriching'];

/**
 * Stage tone → the badge colour `aiux-list` paints the State cell with, via the
 * column's `highlightedValueMap` (which is keyed by the cell's raw value, so the
 * cell carries the state id as its value and the state's name as its displayValue).
 */
const STATE_BADGE_COLOR = {
  neutral: 'low',
  brand: 'info',
  success: 'positive',
  warning: 'warning',
  error: 'critical'
};

/**
 * Read-only list of static demo data. Inline cell editing is ON by default and would
 * open an editor popover on any double-click, so it is switched off explicitly; the
 * column-filter header button is off too, since focusing a state on the refining path
 * is what narrows this list. Module-level rather than a literal per render —
 * `listConfig` is a plain Object property, so a fresh object each render reads as a
 * change even when nothing in it moved.
 */
const LIST_CONFIG = {
  cellEditingEnabled: false,
  enableColumnFiltering: false,
  wrapCellContent: true,
  wrapLineCount: 2
};

/** Shown in the Readability column for an article that has no rewritten version yet. */
const NO_VALUE = '—';

/** Caps a real content blob (raw HTML/Markdown can run to 4,000,000 chars) for the stage-detail code block. */
const CONTENT_PREVIEW_CHARS = 1200;

function previewContent(content) {
  if (!content) return '';
  return content.length > CONTENT_PREVIEW_CHARS
    ? `${content.slice(0, CONTENT_PREVIEW_CHARS)}…`
    : content;
}

function formatScore(score) {
  return score === null || score === undefined ? NO_VALUE : String(score);
}

@customElement('x-snc-kb-refinery-pipeline-page')
export default class PipelinePage extends AIUXElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100%;
      container-type: inline-size;
    }
  `;

  /**
   * Which stage the refining path is focused on, or '' for the resting state (the
   * six-row list). `<pipeline-tunnel>` owns the whole master/detail transition, so the
   * page only holds the id — there is no separate detail panel on the page any more.
   *
   * It also drives the article list at the bottom: focusing a state narrows the list
   * to that state's articles, so the two surfaces are always showing the same thing.
   */
  @state() _selected = '';

  /** Real data for the run currently on screen — see pipeline-data.js. */
  @state() _overview = EMPTY_OVERVIEW;
  @state() _jobSysId = '';
  /** Real, full Job row for the run on screen (articles_total/processed/skipped, etc). */
  @state() _job = null;

  /**
   * Which real article's real per-stage content the stage detail panel is
   * showing — one article threaded through all five stages, picked via the
   * tunnel's own article selector. Defaults to whichever article in this
   * run actually reached 'ready' (see pickDefaultArticleId), so every stage
   * card has something real to show rather than mostly landing on an empty
   * state.
   */
  @state() _selectedArticleId = '';
  /** Real per-stage content/scores for _selectedArticleId — see pipeline-data.js. */
  @state() _articleDetail = null;

  /** Keeps the page current as the run advances — same pattern as pages/home/page.js. */
  _amb = new AMBController(this);

  // Deliberately firstUpdated() and not connectedCallback() — the latter also
  // runs during SSR, and an async fetch resolving there can race client
  // hydration into a duplicated, un-hydrated render (see
  // widget-and-page-conventions.md).
  async firstUpdated() {
    setDocumentTitle(i18n.getMessage('Knowledge Refinery'));
    await this._loadOverview();
  }

  async _loadOverview() {
    try {
      const job = await fetchCurrentJob();
      this._job = job;
      this._overview = await fetchPipelineOverview(job);
      const sysId = job?.sys_id ?? '';
      if (sysId !== this._jobSysId) {
        this._jobSysId = sysId;
        // Job Item is watched too -- the Job row itself only flips a
        // handful of times per run now (pending/running/completed*), so
        // per-article ring/count updates are driven by Job Item changes.
        this._amb.setRecordWatchers(
          sysId
            ? [
                {table: JOB_TABLE, query: `sys_id=${sysId}`},
                {table: JOB_ITEM_TABLE, query: `job=${sysId}`}
              ]
            : [],
          this._handleJobChange
        );
      }
      // Re-pick the default only when the current selection no longer
      // belongs to this run (a new run started, or this is the first
      // load) — an explicit user pick otherwise survives every refresh.
      const stillValid = this._overview.articles.some(a => a.id === this._selectedArticleId);
      if (!stillValid) this._selectedArticleId = pickDefaultArticleId(this._overview.articles);
      // Always reload the selected article's own detail, even when the id
      // didn't change — its real content can advance a stage between two
      // AMB-triggered refreshes.
      await this._loadArticleDetail(this._selectedArticleId);
    } catch (e) {
      // A failed refresh just leaves the last known overview on screen —
      // not worth tearing the page down over.
    }
  }

  /**
   * Pre-bound. The AMB payload isn't guaranteed to carry every field this
   * page needs, so any message is treated as a signal to refetch the whole
   * overview rather than parsed directly.
   */
  _handleJobChange = () => {
    void this._loadOverview();
  };

  async _loadArticleDetail(id) {
    this._selectedArticleId = id;
    if (!id) {
      this._articleDetail = null;
      return;
    }
    try {
      this._articleDetail = await fetchArticleDetail(id);
    } catch (e) {
      // Same policy as _loadOverview -- leave the last known detail on
      // screen rather than blanking the panel over one failed refresh.
    }
  }

  /** Fired by the tunnel's own article selector. */
  _handleArticleSelect(id) {
    if (id && id !== this._selectedArticleId) void this._loadArticleDetail(id);
  }

  /**
   * The title cell carries its own article record on `cell.metadata` — the documented
   * place to hang consumer data for exactly this, and it keeps the row → record lookup
   * out of `render()`, which must stay side-effect free for SSR.
   *
   * `article.id` is the Analysis record's own sys_id, so this opens the real analysis
   * report page rather than the old mocked comparison dialog.
   */
  _handleArticleLinkClick(e) {
    const article = e.detail?.cellData?.metadata?.article;
    if (article) void navigate(`${ANALYSIS_REPORT_PATH_PREFIX}${article.id}`);
  }

  /**
   * Live fill fraction (0-1) for the ring at `RING_STAGE_IDS[uptoIndex]` — how much of
   * this run has cleared that ring or gone further, real Job Item counts driving the
   * pipeline-tunnel hero's progress arcs (see pipeline-tunnel.js's `_renderRing`)
   * instead of the old decorative, disconnected orbit demo.
   *
   * Denominator is `job.articles_processed` — the count that actually entered the
   * path this run (excludes 'skipped', which never did). Numerator is that total minus
   * whoever is still sitting at or behind this ring; ready/no_gaps/no_evidence/failed
   * articles have all cleared every ring, whether they succeeded or exited early.
   */
  _ringProgress(uptoIndex) {
    const processed = this._job?.articles_processed || 0;
    if (!processed) return 0;
    const counts = this._overview.stageCounts;
    const behind = RING_STAGE_IDS.slice(0, uptoIndex + 1).reduce(
      (sum, id) => sum + (counts[id] || 0),
      0
    );
    return Math.max(0, Math.min(1, (processed - behind) / processed));
  }

  _stats() {
    const stats = this._overview.stats;
    return [
      {
        label: i18n.getMessage('On the refining path'),
        value: stats.onPath,
        formattedValue: String(stats.onPath),
        sentiment: 'neutral'
      },
      {
        label: i18n.getMessage('AI-ready'),
        value: stats.ready,
        formattedValue: String(stats.ready),
        sentiment: 'positive'
      },
      {
        label: i18n.getMessage('Awaiting LLM callback'),
        value: stats.awaitingCallback,
        formattedValue: String(stats.awaitingCallback),
        sentiment: 'neutral'
      },
      {
        label: i18n.getMessage('Left the path early'),
        value: stats.leftEarly,
        formattedValue: String(stats.leftEarly),
        sentiment: 'negative'
      }
    ];
  }

  /**
   * The five states an article moves through on the refining path. `kind` decides how
   * the path draws each one — `ring` gets a ring and a numbered row, `core` is the
   * centre.
   *
   * `example` is what the focused detail shows: one real article's own actual input
   * and output at that step, side by side — the same article across all five stages
   * (`_selectedArticleId`/`_articleDetail`, driven by the tunnel's own article
   * selector), so "what happens here" is demonstrated with real content rather than
   * described. `example` is `null` when that article hasn't reached this stage yet
   * (or none is selected) — `emptyMessage` is shown in its place.
   *
   * The three off-path terminals (`kind: 'exit'`) live in `_exits()` — they are still
   * real states and their articles still show in the list below, but they are
   * deliberately kept off the refining path so its own list stays five rows.
   */
  _stages() {
    const summary = this._overview.articles.find(a => a.id === this._selectedArticleId) ?? null;
    const detail = this._articleDetail;
    const job = this._job;
    const raw = detail?.snapshots?.raw ?? null;
    const converted = detail?.snapshots?.converted ?? null;
    const enriched = detail?.snapshots?.enriched ?? null;
    const knowledge = detail?.enrichmentKnowledge?.ai_ready_knowledge ?? null;

    return [
      {
        id: 'ingested',
        kind: 'ring',
        ringIndex: 1,
        icon: 'inbox-queue',
        tone: 'neutral',
        name: i18n.getMessage('Ingest'),
        count: this._overview.stageCounts.ingested,
        progress: this._ringProgress(0),
        sub: i18n.getMessage('queued for conversion'),
        desc: i18n.getMessage(
          'Active, published articles updated in the last two years, capped at 10 per automatic run. An article already AI-ready and unchanged is skipped rather than re-refined.'
        ),
        example: raw
          ? {
              in: {
                label: i18n.getMessage('Raw article'),
                caption: i18n.getMessage('As stored on the source article'),
                kind: 'code',
                lines: [previewContent(raw.content)]
              },
              out: {
                label: i18n.getMessage('Raw score'),
                caption: i18n.getMessage(
                  'The baseline every later stage is compared against'
                ),
                kind: 'list',
                items: [
                  {
                    label: i18n.getMessage('mechanical score'),
                    text: i18n.getMessage('{score} / 100', {
                      score: formatScore(raw.score)
                    })
                  },
                  {
                    label: i18n.getMessage('this article'),
                    text:
                      summary?.stageId === 'skipped'
                        ? i18n.getMessage('Skipped — already AI-ready and unchanged')
                        : i18n.getMessage('Queued for conversion')
                  },
                  {
                    label: i18n.getMessage('this run'),
                    text: i18n.getMessage('{processed} processed, {skipped} skipped', {
                      processed: String(job?.articles_processed ?? 0),
                      skipped: String(job?.articles_skipped ?? 0)
                    })
                  }
                ]
              }
            }
          : null,
        emptyMessage: raw
          ? null
          : summary
            ? i18n.getMessage("This article hasn't been ingested yet.")
            : i18n.getMessage('No job has run yet — start a run to see real activity here.')
      },
      {
        id: 'converted',
        kind: 'ring',
        ringIndex: 2,
        icon: 'code',
        tone: 'brand',
        name: i18n.getMessage('Convert'),
        count: this._overview.stageCounts.converted,
        progress: this._ringProgress(1),
        sub: i18n.getMessage('HTML → Markdown'),
        desc: i18n.getMessage(
          'The only step with no model in it. The body becomes Markdown, external links are HEAD-checked into broken-link findings, and both versions are scored — so conversion alone is measurable before any LLM runs.'
        ),
        example:
          raw && converted
            ? {
                in: {
                  label: i18n.getMessage('Authored HTML'),
                  caption: i18n.getMessage('As stored on the source article'),
                  kind: 'code',
                  lines: [previewContent(raw.content)]
                },
                out: {
                  label: i18n.getMessage('Markdown'),
                  caption: i18n.getMessage('{count} broken link(s) · mechanical score {score}', {
                    count: String(converted.brokenLinkCount ?? 0),
                    score: formatScore(converted.score)
                  }),
                  kind: 'code',
                  lines: [previewContent(converted.content)]
                }
              }
            : null,
        emptyMessage:
          raw && converted
            ? null
            : i18n.getMessage("This article hasn't been converted yet.")
      },
      {
        id: 'analyzed',
        kind: 'ring',
        ringIndex: 3,
        icon: 'magnifying-glass',
        tone: 'brand',
        name: i18n.getMessage('Analyze'),
        count: this._overview.stageCounts.analyzed,
        progress: this._ringProgress(2),
        sub: i18n.getMessage('quality analysis · call 1'),
        desc: i18n.getMessage(
          "One batched call returns the article's findings, its search terms, a target audience and the model's own score. Results land through the callback rather than inline, so this state can hold several batches at once."
        ),
        example:
          converted?.llmScore != null
            ? {
                in: {
                  label: i18n.getMessage('Findings'),
                  caption: detail.findingCount
                    ? i18n.getMessage('{shown} of {total}, worst first', {
                        shown: String(detail.findings.length),
                        total: String(detail.findingCount)
                      })
                    : i18n.getMessage('Nothing flagged on this article'),
                  kind: 'list',
                  items: detail.findings.length
                    ? detail.findings.map(finding => ({
                        label: finding.severity
                          ? `${finding.type} · ${finding.severity}`
                          : finding.type,
                        text: finding.detail || NO_VALUE
                      }))
                    : [
                        {
                          label: i18n.getMessage('no findings'),
                          text: i18n.getMessage(
                            'Call 1 flagged nothing on this article'
                          )
                        }
                      ]
                },
                out: {
                  label: i18n.getMessage('Classification'),
                  caption: i18n.getMessage(
                    'What the duplicate pass and the incident lookup both key off'
                  ),
                  kind: 'list',
                  items: [
                    {
                      label: i18n.getMessage('audience'),
                      text: detail.targetAudience || NO_VALUE
                    },
                    {
                      label: i18n.getMessage('search terms'),
                      text: detail.searchTerms.length ? detail.searchTerms.join(', ') : NO_VALUE
                    },
                    {
                      label: i18n.getMessage('llm score'),
                      text: i18n.getMessage('{score} / 100', {score: formatScore(converted.llmScore)})
                    }
                  ]
                }
              }
            : null,
        emptyMessage:
          converted?.llmScore != null
            ? null
            : i18n.getMessage("This article hasn't been analyzed yet.")
      },
      {
        id: 'enriching',
        kind: 'ring',
        ringIndex: 4,
        icon: 'list-search',
        tone: 'brand',
        name: i18n.getMessage('Enrich'),
        count: this._overview.stageCounts.enriching,
        progress: this._ringProgress(3),
        sub: i18n.getMessage('incident lookup · call 2'),
        desc: i18n.getMessage(
          'Only articles carrying a genuine content gap get here. A structured pre-filter runs first, then one call asks which of the matched incidents reveal what the article is missing. The Call 3 rewrite and its re-score run on from here, with no step of their own.'
        ),
        example: knowledge
          ? {
              in: {
                label: i18n.getMessage('The pre-filter'),
                caption: i18n.getMessage('Run synchronously, just before the call'),
                kind: 'list',
                items: [
                  {
                    label: i18n.getMessage('incidents'),
                    text: i18n.getMessage(
                      'Resolved or closed · last 12 months · category when the article has one'
                    )
                  },
                  {
                    label: i18n.getMessage('term overlap'),
                    text: detail.searchTerms.length
                      ? detail.searchTerms.join(', ')
                      : NO_VALUE
                  }
                ]
              },
              out: {
                label: i18n.getMessage('Related incidents surfaced'),
                caption: detail.evidence.length
                  ? i18n.getMessage('Each one, and what it revealed')
                  : i18n.getMessage('No incidents matched this article'),
                kind: 'list',
                items: detail.evidence.length
                  ? detail.evidence.map(e => ({
                      label: e.incidentNumber,
                      text: e.newInformation
                        ? `${e.incidentShortDescription} — ${e.newInformation}`
                        : e.incidentShortDescription
                    }))
                  : [
                      {
                        label: i18n.getMessage('general practice'),
                        text: i18n.getMessage(
                          'No incidents matched — extracted from standard, well-established practice instead'
                        )
                      }
                    ]
              }
            }
          : null,
        // Checked in this order so a still-loading detail (detail === null)
        // never gets misread as "confirmed no gap" — that's a real,
        // different fact this data can't yet speak to.
        emptyMessage: knowledge
          ? null
          : detail
            ? detail.hasGap
              ? i18n.getMessage("Incident lookup didn't find usable evidence for this article's gap.")
              : i18n.getMessage(
                  'This article had no content gap for incident lookup to close — it moved straight to AI-ready.'
                )
            : i18n.getMessage("This article hasn't reached enrichment yet.")
      },
      {
        id: 'ready',
        kind: 'core',
        ringIndex: null,
        icon: 'circle-check',
        tone: 'success',
        name: i18n.getMessage('AI Ready'),
        count: this._overview.stageCounts.ready,
        sub: i18n.getMessage('enriched version published'),
        desc: i18n.getMessage(
          'Every version is kept rather than overwritten, so a rerun is a new comparison rather than a replacement. The source article stays the system of record.'
        ),
        example:
          raw && enriched?.score != null
            ? {
                in: {
                  label: i18n.getMessage('What an agent saw before'),
                  caption: i18n.getMessage('Raw HTML · mechanical score {score}', {
                    score: formatScore(raw.score)
                  }),
                  kind: 'code',
                  lines: [previewContent(raw.content)]
                },
                out: {
                  label: i18n.getMessage('What it reads now'),
                  caption: i18n.getMessage('Enriched Markdown · mechanical score {score}', {
                    score: formatScore(enriched.score)
                  }),
                  kind: 'code',
                  lines: [previewContent(enriched.content)]
                }
              }
            : null,
        emptyMessage:
          raw && enriched?.score != null
            ? null
            : i18n.getMessage("This article hasn't completed the full refining path yet.")
      }
    ];
  }

  /**
   * The three terminals an article can leave the path through. Kept off the refining
   * path so its own list stays five rows, but they are still real states — the article
   * list below carries their articles too, tagged with the state they ended in, which
   * is where an article that left the path is actually found.
   */
  _exits() {
    return [
      {
        id: 'no_gaps',
        kind: 'exit',
        tone: 'neutral',
        name: i18n.getMessage('No gaps found'),
        count: this._overview.stageCounts.no_gaps
      },
      {
        id: 'no_evidence',
        kind: 'exit',
        tone: 'warning',
        name: i18n.getMessage('No evidence'),
        count: this._overview.stageCounts.no_evidence
      },
      {
        id: 'failed',
        kind: 'exit',
        tone: 'error',
        name: i18n.getMessage('Failed'),
        count: this._overview.stageCounts.failed
      }
    ];
  }

  /**
   * The source the path feeds from — the knowledge base as authored, before any of
   * this runs. Deliberately its own node rather than a stage: nothing in the pipeline
   * ever puts an article back here.
   */
  _source() {
    return {
      kicker: i18n.getMessage('Source'),
      name: i18n.getMessage('Original KB'),
      desc: i18n.getMessage('Authored HTML, written for people'),
      count: this._overview.sourceCount.toLocaleString(),
      unit: i18n.getMessage('articles')
    };
  }

  /**
   * The mechanical score at each of the three content stages, averaged
   * across this run's articles. One rubric, computed identically every
   * time, which is what makes the three numbers comparable — see the
   * re-scoring notes in docs/plan.md. `—` when this run has no snapshot of
   * that type yet (e.g. nothing has reached enriched yet).
   */
  _scoreTrack() {
    const track = this._overview.scoreTrack;
    const label = value => (value === null ? NO_VALUE : String(value));
    return [
      {label: i18n.getMessage('Rim'), value: label(track.raw), tone: 'raw'},
      {label: i18n.getMessage('Ring 02'), value: label(track.converted), tone: 'mid'},
      {label: i18n.getMessage('Core'), value: label(track.enriched), tone: 'final'}
    ];
  }

  /**
   * Column definitions for the article list. Built once per element and handed back by
   * reference: `aiux-list` measures and caches column widths off this array, and the
   * state filter re-renders the page on every focus change — a fresh array each time
   * would make it re-measure for labels that never moved.
   */
  get _columns() {
    if (!this._columnsCache) {
      this._columnsCache = [
        {
          key: 'title',
          type: 'string',
          label: i18n.getMessage('Article'),
          width: '2.6fr',
          // Turns the title into the row's actionable link — clicking it emits
          // `aiux-list:cell-link-clicked`, which is what opens the comparison dialog.
          showLink: true
        },
        {
          key: 'category',
          type: 'string',
          label: i18n.getMessage('Category'),
          width: '1.3fr'
        },
        {
          key: 'state',
          type: 'choice',
          label: i18n.getMessage('State'),
          width: '1.2fr',
          highlightedValueMap: Object.fromEntries(
            [...this._stages(), ...this._exits()].map(stage => [
              stage.id,
              {
                color: STATE_BADGE_COLOR[stage.tone] ?? 'low',
                variant: 'tertiary',
                size: 'sm'
              }
            ])
          )
        },
        {
          key: 'health',
          type: 'number',
          label: i18n.getMessage('Health'),
          width: '0.7fr',
          alignment: 'inverse'
        },
        {
          key: 'readability',
          type: 'string',
          label: i18n.getMessage('Readability'),
          width: '1fr'
        },
        {
          key: 'signal',
          type: 'string',
          label: i18n.getMessage('Signal'),
          width: '1.6fr'
        }
      ];
    }
    return this._columnsCache;
  }

  render() {
    const stats = this._stats();
    const stages = this._stages();
    const exits = this._exits();
    const allStates = [...stages, ...exits];

    /*
     * One flat article record per real article in this run, already in stage
     * order (see pipeline-data.js) and tagged with the state it sits in — the
     * list applies its own state filter below. stageName is resolved here
     * rather than in pipeline-data.js since the friendly labels are page-side
     * i18n content, not data.
     */
    const stateById = new Map(allStates.map(stage => [stage.id, stage]));
    const articles = this._overview.articles.map(article => ({
      ...article,
      stageName: stateById.get(article.stageId)?.name ?? article.stageId
    }));

    // Focusing a state on the refining path narrows the list to that state's articles.
    const focusedState = this._selected
      ? allStates.find(stage => stage.id === this._selected)
      : null;
    const visible = focusedState
      ? articles.filter(article => article.stageId === focusedState.id)
      : articles;

    const rows = visible.map(article => ({
      key: article.id,
      cells: {
        title: {value: article.title, metadata: {article}},
        category: {value: article.category},
        // Value is the state id so the column's badge map can key off it; the name is
        // what actually renders.
        state: {value: article.stageId, displayValue: article.stageName},
        health: {value: article.health},
        readability: {
          value: article.readability
            ? i18n.getMessage('{from} → {to}', {
                from: article.readability.from,
                to: article.readability.to
              })
            : NO_VALUE
        },
        // Whatever the state itself doesn't say — a gap count, a matched-incident
        // count, a duplicate pairing — falling back to the plain status line.
        signal: {value: article.flag?.label ?? article.meta ?? ''}
      }
    }));

    return html`
      <div class="mx-auto flex max-w-7xl flex-col gap-6 p-4 lg:p-8">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 class="text-3xl font-bold tracking-tight text-text-primary">
              ${i18n.getMessage('Knowledge Refinery')}
            </h1>
            <p class="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-secondary">
              ${i18n.getMessage(
                '{count} articles refined from authored HTML into something an agent can read. Pick any state to see what actually happens there.',
                {count: this._overview.sourceCount.toLocaleString()}
              )}
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          ${stats.map(
            stat => html`<aiux-score size="sm" .data=${stat}></aiux-score>`
          )}
        </div>

        <pipeline-tunnel
          .stages=${stages}
          .selected=${this._selected}
          .inFlight=${stats[0].value}
          .source=${this._source()}
          .scoreTrack=${this._scoreTrack()}
          .scoreNote=${i18n.getMessage(
            'One mechanical score, computed identically at every stage — so the progression is genuinely comparable, not three different rubrics.'
          )}
          .articles=${articles.map(article => ({id: article.id, title: article.title}))}
          .selectedArticleId=${this._selectedArticleId}
          @pipeline-tunnel:stage-select=${e => {
            this._selected = e.detail.id;
          }}
          @pipeline-tunnel:article-select=${e => this._handleArticleSelect(e.detail.id)}
        ></pipeline-tunnel>

        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 class="text-base font-bold text-text-primary">
            ${focusedState
              ? i18n.getMessage('Articles in {state}', {
                  state: focusedState.name
                })
              : i18n.getMessage('Articles by state')}
          </h2>
          ${focusedState
            ? html`
                <button
                  type="button"
                  class="aiux-link aiux-link-hover aiux-link-primary text-xs font-semibold"
                  @click=${() => {
                    this._selected = '';
                  }}
                >
                  ${i18n.getMessage('Show all states ({count})', {
                    count: String(articles.length)
                  })}
                </button>
              `
            : html`<span class="text-xs text-text-tertiary"
                >${i18n.getMessage(
                  'Pick a state above to narrow this to one state.'
                )}</span
              >`}
        </div>
        <aiux-list
          .columnDefinitions=${this._columns}
          .rowDefinitions=${rows}
          .listConfig=${LIST_CONFIG}
          @aiux-list:cell-link-clicked=${e => this._handleArticleLinkClick(e)}
        ></aiux-list>
      </div>
    `;
  }
}
