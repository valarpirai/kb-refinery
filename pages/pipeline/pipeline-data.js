// Real data for the pipeline page, replacing its former hardcoded demo
// arrays. Deliberately its own page-scoped module (not shared with
// pages/home/current-job.js) -- see that file's own header comment on why a
// module imported by 2+ *widget* client bundles is a real deploy-time
// hazard; the same caution is applied here even though pages carry less risk,
// simply to avoid introducing a new shared-module question mid-pass. Only
// pages/pipeline/page.js imports this.

import {aiuxFetch} from '@servicenow/aiux/aiux-components-core';

export const JOB_TABLE = 'x_snc_kb_refinery_job';
export const JOB_ITEM_TABLE = 'x_snc_kb_refinery_job_item';

const ANALYSIS_TABLE = 'x_snc_kb_refinery_analysis';
const SNAPSHOT_TABLE = 'x_snc_kb_refinery_snapshot';
const FINDING_TABLE = 'x_snc_kb_refinery_finding';
const EVIDENCE_TABLE = 'x_snc_kb_refinery_evidence';
const KB_TABLE = 'kb_knowledge';

const FINISHED_STATUSES = ['completed', 'completed_with_errors', 'failed'];

/**
 * Finding types that indicate a genuine content gap -- mirrors
 * RefineryOrchestrator.CONTENT_GAP_FINDING_TYPES exactly (kept as its own
 * copy here since this is client-side page code, not a script include).
 * Exported for fetchArticleDetail()'s own hasGap check below, and for
 * page.js's stage-detail builder.
 */
export const GAP_FINDING_TYPES = new Set([
  'outdated',
  'incomplete',
  'no_resolution_steps',
  'missing_context',
  'no_error_guidance',
  'missing_prerequisites'
]);

/**
 * x_snc_kb_refinery_job_item.status -> this page's ring stage id, for an
 * article still in flight (see bucketArticle() below for the terminal/exit
 * overrides on top of this). Real per-article state now, not a Job.status
 * approximation -- deduplication is folded into the analyzing/scoring steps
 * server-side (see refineryOrchestrator.server.js) and has no dedicated ring
 * on this page, matching the plan's own documented decision.
 *
 * `scoring` -- the Call 3 rewrite and its immediate re-score -- deliberately
 * maps to `enriching` rather than to a stage of its own: the pipeline page
 * shows four on-path steps, and an article mid-rewrite is still in flight
 * rather than AI-ready, so Enrich is where it belongs. Without this mapping
 * those articles would bucket to a stage id no stage answers to, and the
 * page's own list would fall back to showing the raw status as their label.
 */
const ITEM_STATUS_TO_STAGE = {
  pending: 'ingested',
  converting: 'converted',
  analyzing: 'analyzed',
  enriching: 'enriching',
  scoring: 'enriching'
};

async function getTable(table, params) {
  // Without this, the Table API wraps every Reference field as
  // {link: "...", value: "<sys_id>"} instead of a plain string -- even
  // with sysparm_display_value=false. `parent`/`source_record` below are
  // exactly such fields, and both are used as join keys.
  params.set('sysparm_exclude_reference_link', 'true');
  const response = await aiuxFetch(`/api/now/table/${table}?${params}`);
  if (!response.ok) {
    throw new Error(`${table} query failed: ${response.status}`);
  }
  const totalCount = Number(response.headers.get('X-Total-Count') ?? 0);
  const rows = (await response.json())?.result ?? [];
  return {rows, totalCount};
}

/**
 * Max sys_ids per `IN` clause.
 *
 * The Table API refuses a GET whose `sysparm_query` is too long to build its
 * own response pagination-header URLs, answering `400 Bad Request` with
 * "Pagination not supported". The refusal is about the query STRING's length,
 * not the row count -- the error suggests raising `sysparm_limit` past a
 * threshold to bypass pagination, and that does not help: measured against
 * surfuat2, an 80-id `parentIN` (~2639 chars) is refused even at
 * `sysparm_limit=400`, while 60 ids (~1979 chars) is accepted. So the only
 * reliable fix is to keep each query short. 40 ids is ~1319 chars, well below
 * the boundary with room for the field list and the other params.
 *
 * This only bites once a run is actually big: every job before the first
 * 186-article one had a single article, so a one-shot `IN` list was ~33 chars
 * and nothing ever came close. At 186 ids it is ~6100 chars and every query
 * built this way fails at once, which takes the whole page's data with it.
 */
const IN_CHUNK_SIZE = 40;

function chunkIds(ids, size = IN_CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * One logical `... IN (ids)` query, issued as however many chunked requests
 * `ids` needs, with the rows concatenated back together. `buildParams(chunk)`
 * builds the params for a single chunk.
 *
 * Chunks are requested in parallel but their rows are concatenated in chunk
 * order, and each chunk's own internal ordering is whatever the query asked
 * for. That is enough for every caller here: the chunks partition the id list,
 * so all of a given parent's rows land in exactly one chunk, and the only
 * order-sensitive consumer (latestSnapshotsByParent, which relies on
 * ORDERBYDESCprocessed_at to take the newest snapshot per parent) reduces
 * per parent rather than across the whole result.
 */
async function getTableChunkedByIds(table, ids, buildParams) {
  if (!ids.length) return {rows: []};
  const results = await Promise.all(
    chunkIds(ids).map(chunk => getTable(table, buildParams(chunk)))
  );
  return {rows: results.flatMap(result => result.rows)};
}

/**
 * The run the page should show: the most recent one still in flight, else
 * the most recent of any status, else `null`. Mirrors
 * pages/home/current-job.js's fetchCurrentJob() logic, widened to the extra
 * fields this page needs.
 */
export async function fetchCurrentJob() {
  const {rows} = await getTable(
    JOB_TABLE,
    new URLSearchParams({
      sysparm_query: 'ORDERBYDESCsys_created_on',
      sysparm_fields:
        'sys_id,status,articles_total,articles_processed,articles_skipped,duplicates_found,broken_links_found',
      sysparm_limit: '5',
      sysparm_display_value: 'false'
    })
  );
  const inFlight = rows.find(row => !FINISHED_STATUSES.includes(row.status));
  return inFlight ?? rows[0] ?? null;
}

/**
 * The Table API serializes every field as a JSON string, even Integer
 * columns (`"score": "82"`, never `82`) -- confirmed platform behavior.
 * Coerced here, at the one place every snapshot row funnels through, so
 * `average()`/the `typeof === 'number'` checks below actually see real
 * numbers instead of always failing on a string.
 */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** JSON-column fields (search_terms, enrichment_knowledge) come back as a plain string. */
function safeParseArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function safeParseObject(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

/** Reduces a desc-ordered snapshot list to the latest row per (parent, type). */
function latestSnapshotsByParent(rows) {
  const byParent = new Map();
  for (const row of rows) {
    if (!byParent.has(row.parent)) byParent.set(row.parent, {});
    const forParent = byParent.get(row.parent);
    if (!(row.type in forParent)) forParent[row.type] = {...row, score: toNumber(row.score)};
  }
  return byParent;
}

function average(values) {
  const nums = values.filter(v => typeof v === 'number' && !Number.isNaN(v));
  if (!nums.length) return null;
  return Math.round(nums.reduce((sum, v) => sum + v, 0) / nums.length);
}

/**
 * @param {{pipeline_stage?: string, enrichment_knowledge?: string} | null} analysis
 * @param {string} itemStatus - x_snc_kb_refinery_job_item.status for this article
 * @param {boolean} hasGap
 */
function bucketArticle(analysis, itemStatus, hasGap) {
  if (itemStatus === 'completed') {
    // 'ready' only when the article went through the full enrich/rewrite/
    // rescore path; otherwise it exited early because analyzing found no
    // content-gap Finding worth enriching.
    return analysis?.pipeline_stage === 'ready' ? 'ready' : 'no_gaps';
  }
  if (itemStatus === 'failed') {
    // A genuine dispatch/LLM failure and the enriching phase's "couldn't
    // extract usable knowledge" skip both land on 'failed' server-side (see
    // refineryOrchestrator.server.js) -- this can't fully disambiguate a
    // real analyzing-phase failure from a no-evidence skip, since both have
    // a gap Finding with no enrichment_knowledge. Accepted, documented
    // approximation (kb-refinery-domain.md), unchanged by this rework.
    return hasGap && !analysis?.enrichment_knowledge ? 'no_evidence' : 'failed';
  }
  if (itemStatus === 'skipped') return 'skipped';
  return ITEM_STATUS_TO_STAGE[itemStatus] || 'ingested';
}

const EMPTY_OVERVIEW_COUNTS = {
  ingested: 0,
  converted: 0,
  analyzed: 0,
  enriching: 0,
  ready: 0,
  no_gaps: 0,
  no_evidence: 0,
  failed: 0,
  skipped: 0
};

/**
 * Everything pages/pipeline/page.js needs to render real data: per-stage
 * counts (ring stages + the three exits, grouped by real Job Item status),
 * the flattened per-article list (already tagged with stageId/stageName, in
 * the shape the page's existing row-building code expects), top-line stats,
 * the live source count, and mechanical-score averages per snapshot type.
 *
 * @param {{sys_id: string, status: string, ...} | null} job
 */
export async function fetchPipelineOverview(job) {
  // Independent of any job -- always real, always available.
  const {totalCount: sourceCount} = await getTable(
    KB_TABLE,
    new URLSearchParams({
      sysparm_query: 'active=true^workflow_state=published',
      sysparm_fields: 'sys_id',
      sysparm_limit: '1'
    })
  );

  if (!job) {
    return {
      stageCounts: {...EMPTY_OVERVIEW_COUNTS},
      stats: {onPath: 0, ready: 0, pendingBatchCount: 0, leftEarly: 0},
      sourceCount,
      scoreTrack: {raw: null, converted: null, enriched: null},
      articles: []
    };
  }

  const {rows: jobItemRows} = await getTable(
    JOB_ITEM_TABLE,
    new URLSearchParams({
      sysparm_query: `job=${job.sys_id}`,
      sysparm_fields: 'sys_id,status,analysis',
      sysparm_display_value: 'false',
      // One row per article in the run, and a run can be large -- the first
      // 186-article job already sat just under the old cap of 200, which
      // truncates in silence rather than erroring. The query itself is short
      // (one sys_id), so a high limit costs nothing and also keeps the
      // response off the pagination path entirely -- see IN_CHUNK_SIZE.
      sysparm_limit: '2000'
    })
  );

  const analysisIds = [...new Set(jobItemRows.map(row => row.analysis).filter(Boolean))];

  // Each of these is chunked -- see getTableChunkedByIds. The per-chunk limits
  // are sized for one chunk's worth of rows, not the whole run: at most one
  // Analysis per id, and (raw/converted/enriched) snapshots plus findings per id.
  const [analysisResult, snapshotResult, findingResult] = await Promise.all([
    getTableChunkedByIds(ANALYSIS_TABLE, analysisIds, chunk =>
      new URLSearchParams({
        sysparm_query: `sys_idIN${chunk.join(',')}`,
        sysparm_fields: 'sys_id,number,source_record,pipeline_stage,enrichment_knowledge',
        sysparm_display_value: 'false',
        sysparm_limit: String(chunk.length)
      })
    ),
    getTableChunkedByIds(SNAPSHOT_TABLE, analysisIds, chunk =>
      new URLSearchParams({
        sysparm_query: `parentIN${chunk.join(',')}^ORDERBYDESCprocessed_at`,
        sysparm_fields: 'sys_id,parent,type,score,processed_at',
        sysparm_display_value: 'false',
        sysparm_limit: String(chunk.length * 10)
      })
    ),
    getTableChunkedByIds(FINDING_TABLE, analysisIds, chunk =>
      new URLSearchParams({
        sysparm_query: `parentIN${chunk.join(',')}`,
        sysparm_fields: 'sys_id,parent,type',
        sysparm_display_value: 'false',
        sysparm_limit: String(chunk.length * 25)
      })
    )
  ]);

  const analysisById = new Map(analysisResult.rows.map(row => [row.sys_id, row]));
  const kbSysIds = [...new Set(analysisResult.rows.map(row => row.source_record).filter(Boolean))];

  const {rows: kbRows} = await getTableChunkedByIds(KB_TABLE, kbSysIds, chunk =>
    new URLSearchParams({
      sysparm_query: `sys_idIN${chunk.join(',')}`,
      sysparm_fields: 'sys_id,short_description,kb_category',
      sysparm_display_value: 'true',
      sysparm_limit: String(chunk.length)
    })
  );

  const kbById = new Map(kbRows.map(row => [row.sys_id, row]));
  const snapshotsByAnalysis = latestSnapshotsByParent(snapshotResult.rows);

  const findingsByAnalysis = new Map();
  for (const finding of findingResult.rows) {
    if (!findingsByAnalysis.has(finding.parent)) findingsByAnalysis.set(finding.parent, []);
    findingsByAnalysis.get(finding.parent).push(finding.type);
  }

  const stageCounts = {...EMPTY_OVERVIEW_COUNTS};
  const articles = [];
  const rawScores = [];
  const convertedScores = [];
  const enrichedScores = [];

  for (const jobItem of jobItemRows) {
    const analysis = analysisById.get(jobItem.analysis) || null;
    const findingTypes = analysis ? findingsByAnalysis.get(analysis.sys_id) || [] : [];
    const hasGap = findingTypes.some(type => GAP_FINDING_TYPES.has(type));
    const hasDuplicate = findingTypes.includes('duplicate');
    const brokenLinkCount = findingTypes.filter(type => type === 'broken_link').length;

    const bucket = bucketArticle(analysis, jobItem.status, hasGap);
    stageCounts[bucket] = (stageCounts[bucket] || 0) + 1;

    const snaps = analysis ? snapshotsByAnalysis.get(analysis.sys_id) || {} : {};
    if (typeof snaps.raw?.score === 'number') rawScores.push(snaps.raw.score);
    if (typeof snaps.converted?.score === 'number') convertedScores.push(snaps.converted.score);
    if (typeof snaps.enriched?.score === 'number') enrichedScores.push(snaps.enriched.score);

    const kb = analysis ? kbById.get(analysis.source_record) : null;
    // Analysis.number is a plain string, always populated by the platform on
    // insert -- unlike kb?.short_description (a cross-table join that can
    // fail to resolve), it can never come back malformed. Led with it here so
    // the column always shows something meaningful and never falls back to a
    // raw sys_id. Falls back to the Job Item's own sys_id in the rare case an
    // article hasn't reached conversion yet and has no Analysis row at all.
    const title = analysis
      ? [analysis.number, kb?.short_description].filter(Boolean).join(' — ') || analysis.source_record
      : jobItem.sys_id;
    const health = snaps.enriched?.score ?? snaps.converted?.score ?? snaps.raw?.score ?? null;
    const readability =
      typeof snaps.enriched?.score === 'number' && typeof snaps.converted?.score === 'number'
        ? {from: String(snaps.converted.score), to: String(snaps.enriched.score)}
        : null;

    let signal = '';
    if (bucket === 'no_gaps') signal = 'No gaps found';
    else if (bucket === 'no_evidence') signal = 'No evidence found';
    else if (bucket === 'skipped') signal = 'Already up to date';
    else if (hasDuplicate) signal = 'Duplicate pair';
    else if (brokenLinkCount > 0) signal = `${brokenLinkCount} broken link(s)`;
    else if (hasGap) signal = `${findingTypes.filter(t => GAP_FINDING_TYPES.has(t)).length} gap finding(s)`;

    articles.push({
      id: analysis?.sys_id || jobItem.sys_id,
      title,
      category: kb?.kb_category || '',
      health: health ?? 0,
      readability,
      meta: signal,
      flag: hasDuplicate ? {label: 'Duplicate pair', tone: 'neutral'} : null,
      stageId: bucket,
      stageName: bucket
    });
  }

  const readyCount = stageCounts.ready;
  const leftEarly = stageCounts.no_gaps + stageCounts.no_evidence + stageCounts.failed;
  const articlesProcessed = job.articles_processed || 0;

  // Stage order, so the article list reads as a sensible left-to-right sample
  // rather than whatever order the Table API happened to return.
  const STAGE_ORDER = [
    'ingested', 'converted', 'analyzed', 'enriching',
    'ready', 'no_gaps', 'no_evidence', 'failed', 'skipped'
  ];
  articles.sort((a, b) => STAGE_ORDER.indexOf(a.stageId) - STAGE_ORDER.indexOf(b.stageId));

  return {
    stageCounts,
    stats: {
      onPath: Math.max(0, articlesProcessed - readyCount - leftEarly),
      ready: readyCount,
      // Real count of articles with an outstanding LLM dispatch right now
      // (analyzing/enriching/scoring job items) -- replaces the old
      // Job.pending_batch_count job-level approximation. Still covers the
      // scoring ones: they bucket into `enriching` now, see
      // ITEM_STATUS_TO_STAGE above.
      awaitingCallback: stageCounts.analyzed + stageCounts.enriching,
      leftEarly
    },
    sourceCount,
    scoreTrack: {
      raw: average(rawScores),
      converted: average(convertedScores),
      enriched: average(enrichedScores)
    },
    articles
  };
}

/**
 * The article whose stage detail should be shown by default: whichever one
 * actually reached 'ready' (so every one of the six stage cards has real
 * content to show, rather than most of them landing on an empty state), else
 * just the first real article in the run, else none.
 */
export function pickDefaultArticleId(articles) {
  if (!articles.length) return '';
  const ready = articles.find(a => a.stageId === 'ready');
  return (ready ?? articles[0]).id;
}

/** How many findings/evidence/knowledge items a stage detail shows per side. */
const DETAIL_LIST_LIMIT = 4;

/** Severity order for the findings preview. Anything unset sorts last. */
const SEVERITY_RANK = {high: 0, medium: 1, low: 2};
function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 3;
}

/**
 * Every real per-stage record for one article -- across its full history,
 * not scoped to the current job -- for the pipeline page's stage detail
 * panel: raw/converted/enriched Snapshot content and scores (from this
 * Analysis' single latest run, matched by exact `version` -- see the
 * fetch below), real Findings (with their own severity and detail text,
 * ranked worst-first and previewed), real matched-incident Evidence, and
 * the real Call 2 enrichment_knowledge. Replaces the former fabricated in/out
 * example content one real article at a time. Returns `null` if the
 * Analysis row doesn't (or no longer) exist.
 */
export async function fetchArticleDetail(analysisSysId) {
  if (!analysisSysId) return null;

  const {rows: analysisRows} = await getTable(
    ANALYSIS_TABLE,
    new URLSearchParams({
      sysparm_query: `sys_id=${analysisSysId}`,
      sysparm_fields: 'sys_id,pipeline_stage,target_audience,search_terms,enrichment_knowledge',
      sysparm_display_value: 'false',
      sysparm_limit: '1'
    })
  );
  const analysis = analysisRows[0];
  if (!analysis) return null;

  // Filtering by the exact `version` of this Analysis' latest run -- rather
  // than reducing "latest per type" independently -- is what guarantees the
  // raw/converted/enriched shown together actually came from the same run.
  // Snapshot is append-only, so without this a run whose enrichment failed
  // could show that run's raw/converted next to an *older* run's enriched
  // row with nothing to signal they don't belong together -- the exact bug
  // analysis-report-data.js's fetchLatestVersion/fetchSnapshotsForVersion
  // was written to fix; this mirrors that same two-step pattern.
  const [{rows: versionRows}, {rows: findingRows}] = await Promise.all([
    getTable(
      SNAPSHOT_TABLE,
      new URLSearchParams({
        sysparm_query: `parent=${analysisSysId}^type=raw^ORDERBYDESCversion`,
        sysparm_fields: 'version',
        sysparm_display_value: 'false',
        sysparm_limit: '1'
      })
    ),
    getTable(
      FINDING_TABLE,
      new URLSearchParams({
        // `severity`/`detail` are for the analyzed-stage detail's own findings
        // preview; `type` is still the raw choice value (display_value stays
        // 'false'), because GAP_FINDING_TYPES matches on the stored key.
        sysparm_query: `parent=${analysisSysId}`,
        sysparm_fields: 'sys_id,type,severity,detail',
        sysparm_display_value: 'false',
        sysparm_limit: '200'
      })
    )
  ]);
  const latestVersion = versionRows.length ? toNumber(versionRows[0].version) : null;

  const snapshots = {};
  if (latestVersion !== null) {
    const {rows: snapshotRows} = await getTable(
      SNAPSHOT_TABLE,
      new URLSearchParams({
        sysparm_query: `parent=${analysisSysId}^version=${latestVersion}`,
        sysparm_fields: 'sys_id,type,content,score,llm_score,broken_link_count',
        sysparm_display_value: 'false',
        sysparm_limit: '3'
      })
    );
    for (const row of snapshotRows) {
      snapshots[row.type] = {
        content: row.content || '',
        score: toNumber(row.score),
        llmScore: toNumber(row.llm_score),
        brokenLinkCount: toNumber(row.broken_link_count)
      };
    }
  }

  const gapFindingIds = findingRows.filter(f => GAP_FINDING_TYPES.has(f.type)).map(f => f.sys_id);
  let evidence = [];
  if (gapFindingIds.length) {
    const {rows: evidenceRows} = await getTableChunkedByIds(
      EVIDENCE_TABLE,
      gapFindingIds,
      chunk =>
        new URLSearchParams({
          // Dot-walked reference field -- lands as the flat, literally-dotted
          // key 'incident.number'/'incident.short_description', not nested
          // under `incident` (see kb-refinery-pages.md).
          sysparm_query: `findingIN${chunk.join(',')}`,
          sysparm_fields: 'sys_id,new_information,incident.number,incident.short_description',
          sysparm_display_value: 'false',
          sysparm_limit: String(chunk.length * 10)
        })
    );
    evidence = evidenceRows
      .map(row => ({
        incidentNumber: row['incident.number'] || '',
        incidentShortDescription: row['incident.short_description'] || '',
        newInformation: row.new_information || ''
      }))
      .slice(0, DETAIL_LIST_LIMIT);
  }

  return {
    id: analysisSysId,
    pipelineStage: analysis.pipeline_stage,
    targetAudience: analysis.target_audience || '',
    searchTerms: safeParseArray(analysis.search_terms),
    hasGap: findingRows.some(f => GAP_FINDING_TYPES.has(f.type)),
    /*
     * A preview, not the full set -- the analyzed-stage detail shows a few of
     * what Call 1 actually returned rather than the whole list, same as
     * `evidence` above. `type` is the raw choice key (e.g. `no_resolution_steps`),
     * which is what the detail renders as each row's own label.
     */
    findings: [...findingRows]
      // Not ORDERBY'd in the query: `severity` is a choice column whose stored
      // keys sort alphabetically (high, low, medium), which is not its severity
      // order. Ranked here instead, so the preview shows the worst first.
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
      .slice(0, DETAIL_LIST_LIMIT)
      .map(row => ({
        type: row.type || '',
        severity: row.severity || '',
        detail: row.detail || ''
      })),
    findingCount: findingRows.length,
    enrichmentKnowledge: safeParseObject(analysis.enrichment_knowledge),
    evidence,
    snapshots
  };
}
