// Recent Analysis records for the dashboard's "Articles" list, replacing
// its former hardcoded demo rows. Deliberately its own page-scoped module —
// see current-job.js's header comment on why a module shared across 2+
// *widget* client bundles is risky; kept separate from current-job.js since
// this fetch is unrelated to the pipeline-rail's job-status polling. Only
// pages/home/page.js imports this.

import {aiuxFetch} from '@servicenow/aiux/aiux-components-core';

const ANALYSIS_TABLE = 'x_snc_kb_refinery_analysis';
const SNAPSHOT_TABLE = 'x_snc_kb_refinery_snapshot';

const LIST_LIMIT = 10;

async function getTable(table, params) {
  // Without this, the Table API wraps every Reference field as
  // {link: "...", value: "<sys_id>"} instead of a plain string -- even
  // with sysparm_display_value=false. `parent` on the Snapshot fetch below
  // is exactly such a field, and it's used as a join key.
  params.set('sysparm_exclude_reference_link', 'true');
  const response = await aiuxFetch(`/api/now/table/${table}?${params}`);
  if (!response.ok) {
    throw new Error(`${table} query failed: ${response.status}`);
  }
  return (await response.json())?.result ?? [];
}

/**
 * The Table API serializes every field as a JSON string, even Integer
 * columns (`"score": "82"`, never `82`) -- confirmed platform behavior.
 * Coerced once here so the returned rows carry a real `number` (or
 * `null`), not a string.
 */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** Reduces a desc-ordered snapshot list to the latest row per (parent, type). */
function latestByParent(rows) {
  const byParent = new Map();
  for (const row of rows) {
    if (!byParent.has(row.parent)) byParent.set(row.parent, {});
    const forParent = byParent.get(row.parent);
    if (!(row.type in forParent)) forParent[row.type] = row;
  }
  return byParent;
}

/**
 * The most recently touched analyses, for the dashboard's "Articles" list.
 *
 * @returns {Promise<Array<{sysId, title, pipelineStage, pipelineStageLabel, score, llmScore, updatedOn}>>}
 */
export async function fetchRecentAnalyses(limit = LIST_LIMIT) {
  const analysisRows = await getTable(
    ANALYSIS_TABLE,
    new URLSearchParams({
      sysparm_query: 'ORDERBYDESCsys_updated_on',
      sysparm_fields: 'sys_id,standardized_summary,pipeline_stage,sys_updated_on',
      sysparm_display_value: 'all',
      sysparm_limit: String(limit)
    })
  );

  const analysisIds = analysisRows.map(row => row.sys_id.value);
  const snapshotRows = analysisIds.length
    ? await getTable(
        SNAPSHOT_TABLE,
        new URLSearchParams({
          sysparm_query: `parentIN${analysisIds.join(',')}^ORDERBYDESCprocessed_at`,
          sysparm_fields: 'parent,type,score,llm_score',
          sysparm_display_value: 'false',
          sysparm_limit: '500'
        })
      )
    : [];
  const scoresByAnalysis = latestByParent(snapshotRows);

  return analysisRows.map(row => {
    const sysId = row.sys_id.value;
    const snaps = scoresByAnalysis.get(sysId) || {};
    const best = snaps.enriched ?? snaps.converted ?? snaps.raw ?? null;
    return {
      sysId,
      title: row.standardized_summary?.display_value || row.standardized_summary?.value || '',
      pipelineStage: row.pipeline_stage?.value || '',
      pipelineStageLabel: row.pipeline_stage?.display_value || '',
      score: toNumber(best?.score),
      llmScore: toNumber(best?.llm_score),
      updatedOn: row.sys_updated_on?.display_value || ''
    };
  });
}
