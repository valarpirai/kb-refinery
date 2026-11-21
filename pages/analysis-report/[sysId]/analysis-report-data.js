// Data-fetching for the analysis report page. Deliberately its own
// page-scoped module (not shared with pages/pipeline/pipeline-data.js) --
// see that file's own header comment on why a module imported by 2+ pages
// is avoided even though the risk is mostly a *widget*-bundle one. Only
// pages/analysis-report/[sysId]/page.js imports this.

import {aiuxFetch} from '@servicenow/aiux/aiux-components-core';

const ANALYSIS_TABLE = 'x_snc_kb_refinery_analysis';
const SNAPSHOT_TABLE = 'x_snc_kb_refinery_snapshot';
const FINDING_TABLE = 'x_snc_kb_refinery_finding';
const EVIDENCE_TABLE = 'x_snc_kb_refinery_evidence';
const MENTION_TABLE = 'x_snc_kb_refinery_mention';
const PRODUCT_TABLE = 'x_snc_kb_refinery_product';
const KB_KNOWLEDGE_TABLE = 'kb_knowledge';

// Probed in order for any source table other than kb_knowledge, since
// source_record is a polymorphic DocumentIdColumn with no single reliable
// "title" field name across every table it might point at.
const TITLE_FIELD_CANDIDATES = ['short_description', 'title', 'name', 'sys_name'];

const ANALYSIS_FIELDS = [
  'sys_id',
  'source_table',
  'source_record',
  'source_class',
  'source_updated_on',
  'kb_knowledge_base',
  'standardized_summary',
  'search_terms',
  'target_audience',
  'pipeline_stage',
  'enrichment_confidence',
  'enrichment_knowledge',
  'last_job',
  'last_job.status',
  'last_job.error_message',
  'last_job.started_at',
  'last_job.completed_at',
  'last_job.triggered_by'
].join(',');

const SNAPSHOT_CONTENT_FIELDS = [
  'sys_id',
  'type',
  'version',
  'content',
  'score',
  'llm_score',
  'word_count',
  'token_count',
  'image_count',
  'link_count',
  'broken_link_count',
  'processing_message',
  'processed_at',
  'last_job'
].join(',');

const FINDING_FIELDS =
  'sys_id,type,severity,detail,state,related_article,recommended_primary,broken_url,last_job';

// incident's own display value (its `number`) comes for free via
// sysparm_display_value=all on the `incident` reference field itself --
// only short_description/state need an explicit dot-walk.
const EVIDENCE_FIELDS =
  'sys_id,finding,incident,incident.short_description,incident.state,new_information,contradicts_article';

const MENTION_FIELDS = 'sys_id,product,mention_count';
const PRODUCT_FIELDS = 'sys_id,name,type,article_count,dedicated_article';

/**
 * Without this, the Table API wraps every Reference field as
 * `{link: "...", value: "<sys_id>"}` instead of a plain string -- even
 * with `sysparm_display_value: 'false'`. Set unconditionally (never
 * overridden by a call site) so no reference field anywhere in this
 * module can silently come back as an object instead of a sys_id string.
 */
function withReferenceLinksExcluded(params) {
  params.set('sysparm_exclude_reference_link', 'true');
  return params;
}

async function getTable(table, params) {
  const response = await aiuxFetch(`/api/now/table/${table}?${withReferenceLinksExcluded(params)}`);
  if (!response.ok) {
    throw new Error(`${table} query failed: ${response.status}`);
  }
  return (await response.json())?.result ?? [];
}

/**
 * The Table API serializes every field as a JSON string, even Integer
 * columns (`"score": "82"`, never `82`) -- confirmed platform behavior,
 * not specific to this table. Coerced once here, at the data layer, so
 * every consumer can rely on a real `number` (or `null`) rather than each
 * having to know about this quirk.
 */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

const SNAPSHOT_NUMERIC_FIELDS = [
  'version',
  'score',
  'llm_score',
  'word_count',
  'token_count',
  'image_count',
  'link_count',
  'broken_link_count'
];

async function getRecord(table, sysId, params) {
  const response = await aiuxFetch(`/api/now/table/${table}/${sysId}?${withReferenceLinksExcluded(params)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`${table} record fetch failed: ${response.status}`);
  }
  return (await response.json())?.result ?? null;
}

/**
 * Resolves the polymorphic source_table/source_record pair into a real
 * title/number, degrading to {ok: false} rather than throwing for an
 * unknown table, an ACL denial, or a genuinely deleted record -- the report
 * always has analysis.standardized_summary as a title fallback, so this is
 * never allowed to block the rest of the page.
 */
async function resolveSourceRecord(table, sysId) {
  if (!table || !sysId) return {ok: false, reason: 'missing', table: table || '', sysId: sysId || ''};
  try {
    if (table === KB_KNOWLEDGE_TABLE) {
      const rec = await getRecord(
        table,
        sysId,
        new URLSearchParams({
          sysparm_display_value: 'all',
          sysparm_fields: 'sys_id,number,short_description,kb_category,workflow_state'
        })
      );
      if (!rec) return {ok: false, reason: 'not_found_or_denied', table, sysId};
      return {
        ok: true,
        table,
        sysId,
        title: rec.short_description?.display_value || rec.short_description?.value || '',
        number: rec.number?.value || '',
        category: rec.kb_category?.display_value || '',
        workflowState: rec.workflow_state?.display_value || ''
      };
    }

    const rec = await getRecord(table, sysId, new URLSearchParams({sysparm_display_value: 'all'}));
    if (!rec) return {ok: false, reason: 'not_found_or_denied', table, sysId};
    const titleField = TITLE_FIELD_CANDIDATES.find(f => rec[f]?.display_value || rec[f]?.value);
    return {
      ok: true,
      table,
      sysId,
      title: titleField ? rec[titleField].display_value || rec[titleField].value : '',
      number: rec.number?.value || '',
      category: ''
    };
  } catch (e) {
    return {ok: false, reason: 'error', table, sysId};
  }
}

/**
 * Finds the version number of this Analysis' most recent pipeline run, off
 * its 'raw' Snapshot -- every run writes exactly one 'raw' row, so this is a
 * reliable single-row lookup. Ordered by `version` (an integer, assigned as
 * "count of this Analysis' prior raw Snapshots + 1" -- see
 * RefineryOrchestrator._nextSnapshotVersion) rather than by `processed_at`:
 * version directly encodes run order by definition, whereas processed_at is
 * a GlideDateTime with only second-level precision, and raw/converted for
 * the *same* run are written back-to-back synchronously -- close enough in
 * time that relying on timestamp ordering across runs is a weaker guarantee
 * than just reading the run-number field runs exist to provide.
 */
async function fetchLatestVersion(analysisSysId) {
  const rows = await getTable(
    SNAPSHOT_TABLE,
    new URLSearchParams({
      sysparm_query: `parent=${analysisSysId}^type=raw^ORDERBYDESCversion`,
      sysparm_fields: 'version',
      sysparm_display_value: 'false',
      sysparm_limit: '1'
    })
  );
  return rows.length ? toNumber(rows[0].version) : null;
}

/**
 * Fetches the (2 or 3) Snapshot rows belonging to one specific pipeline run
 * -- raw + converted always, enriched only if that run actually produced one
 * (absent when enrichment was skipped, see refineryOrchestrator.server.js's
 * _handleEnrichingResult skip branch, which still writes a message-only
 * empty 'enriched' row at the *same* version, so even that case resolves to
 * exactly one row per type).
 *
 * Filtering by the exact version number -- rather than reducing "latest per
 * type" independently, which is what this page used to do -- is what
 * guarantees raw/converted/enriched shown together always came from the
 * same run. Snapshot is append-only (kb-refinery-domain.md), so without
 * this, a run whose enrichment failed could show that run's raw/converted
 * next to an *older* run's enriched row with no indication they don't
 * belong together.
 */
async function fetchSnapshotsForVersion(analysisSysId, version) {
  const rows = version === null ? [] : await getTable(
    SNAPSHOT_TABLE,
    new URLSearchParams({
      sysparm_query: `parent=${analysisSysId}^version=${version}`,
      sysparm_fields: SNAPSHOT_CONTENT_FIELDS,
      sysparm_display_value: 'false',
      sysparm_limit: '3'
    })
  );
  const snapshots = {raw: null, converted: null, enriched: null};
  rows.forEach(row => {
    for (const field of SNAPSHOT_NUMERIC_FIELDS) row[field] = toNumber(row[field]);
    snapshots[row.type] = row;
  });
  return snapshots;
}

/**
 * Scoped to the Analysis' own latest job (its `last_job`) -- Finding rows
 * are never deleted (append-only across reruns, see
 * RefineryOrchestrator._queryFindings' own comment in
 * refineryOrchestrator.server.js), so an unscoped fetch would show every
 * prior run's findings piled up alongside the current one, including ones
 * already remediated/superseded findings from an older run that no longer
 * reflect the article's current state. Falls back to an unscoped fetch only
 * if this Analysis somehow has no last_job yet (shouldn't happen once a job
 * has actually run it, but a blank query condition is worse than a broad
 * one).
 */
async function fetchFindings(analysisSysId, jobSysId) {
  const query = jobSysId
    ? `parent=${analysisSysId}^last_job=${jobSysId}`
    : `parent=${analysisSysId}`;
  return getTable(
    FINDING_TABLE,
    new URLSearchParams({
      sysparm_query: query,
      sysparm_fields: FINDING_FIELDS,
      // display_value=all so related_article/recommended_primary carry the
      // other Analysis record's standardized_summary as display_value, with
      // no extra round trip.
      sysparm_display_value: 'all',
      sysparm_limit: '200'
    })
  );
}

async function attachEvidence(findings) {
  const findingIds = findings.map(f => f.sys_id?.value).filter(Boolean);
  if (!findingIds.length) return findings.map(f => ({...f, evidence: []}));
  const evidenceRows = await getTable(
    EVIDENCE_TABLE,
    new URLSearchParams({
      sysparm_query: `findingIN${findingIds.join(',')}`,
      sysparm_fields: EVIDENCE_FIELDS,
      sysparm_display_value: 'all',
      sysparm_limit: '500'
    })
  );
  const byFinding = new Map();
  for (const ev of evidenceRows) {
    const key = ev.finding?.value;
    if (!key) continue;
    if (!byFinding.has(key)) byFinding.set(key, []);
    byFinding.get(key).push(ev);
  }
  return findings.map(f => ({...f, evidence: byFinding.get(f.sys_id?.value) || []}));
}

async function fetchMentions(analysisSysId) {
  return getTable(
    MENTION_TABLE,
    new URLSearchParams({
      sysparm_query: `analysis=${analysisSysId}^ORDERBYDESCmention_count`,
      sysparm_fields: MENTION_FIELDS,
      sysparm_display_value: 'false',
      sysparm_limit: '50'
    })
  );
}

async function attachProducts(mentions) {
  const productIds = [...new Set(mentions.map(m => m.product).filter(Boolean))];
  if (!productIds.length) return mentions.map(m => ({...m, product: null}));
  const products = await getTable(
    PRODUCT_TABLE,
    new URLSearchParams({
      sysparm_query: `sys_idIN${productIds.join(',')}`,
      sysparm_fields: PRODUCT_FIELDS,
      sysparm_display_value: 'all',
      sysparm_limit: String(productIds.length)
    })
  );
  const byId = new Map(products.map(p => [p.sys_id?.value, p]));
  // product_sys_id preserves the raw reference value even when the join below
  // fails to resolve it (e.g. a Mention pointing at a since-deleted Product row)
  // -- lets the page surface *which* sys_id didn't resolve, instead of a blank cell.
  return mentions.map(m => ({...m, product_sys_id: m.product, product: byId.get(m.product) || null}));
}

/**
 * Everything pages/analysis-report/[sysId]/page.js needs to render the
 * report, keyed off the Analysis record's own sys_id.
 */
export async function fetchAnalysisReport(sysId) {
  const analysis = await getRecord(
    ANALYSIS_TABLE,
    sysId,
    new URLSearchParams({sysparm_display_value: 'all', sysparm_fields: ANALYSIS_FIELDS})
  );
  if (!analysis) return {sysId, notFound: true};

  const sourceTable = analysis.source_table?.value || '';
  const sourceRecordId = analysis.source_record?.value || '';
  const jobSysId = analysis.last_job?.value || '';

  const [source, latestVersion, findings, mentions] = await Promise.all([
    resolveSourceRecord(sourceTable, sourceRecordId),
    fetchLatestVersion(sysId),
    fetchFindings(sysId, jobSysId),
    fetchMentions(sysId)
  ]);

  const [snapshots, findingsWithEvidence, mentionsWithProduct] = await Promise.all([
    fetchSnapshotsForVersion(sysId, latestVersion),
    attachEvidence(findings),
    attachProducts(mentions)
  ]);

  return {
    sysId,
    notFound: false,
    analysis,
    source,
    snapshots,
    findings: findingsWithEvidence,
    mentions: mentionsWithProduct
  };
}
