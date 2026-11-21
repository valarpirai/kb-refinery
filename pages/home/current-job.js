// Resolves which Knowledge Refinery run the dashboard's pipeline rail shows.
//
// Deliberately page-scoped, the same way pages/pipeline/pipeline-data.js is: a
// local module imported by two or more *client widget bundles* is extracted
// into a per-pass @shared chunk while only one pass's hash is registered as a
// dependency, which 500s at runtime with no build error (see
// environment-build-deploy.md). Only pages/home/page.js imports this.

import {aiuxFetch} from '@servicenow/aiux/aiux-components-core';

export const JOB_TABLE = 'x_snc_kb_refinery_job';
export const JOB_ITEM_TABLE = 'x_snc_kb_refinery_job_item';

/**
 * Job.status is coarse now (pending/running/completed/completed_with_errors/
 * failed) — no per-phase granularity (that lives on x_snc_kb_refinery_job_item
 * instead, see fetchJobItemCounts below). Matches the job-lock guard in
 * RefineryOrchestrator.run.
 */
const FINISHED_STATUSES = ['completed', 'completed_with_errors', 'failed'];

/**
 * Scan a few rows rather than just the newest: a run that finished seconds ago
 * sorts above one that is genuinely still in flight, and the rail should show
 * the live one.
 */
const SCAN_LIMIT = 5;

/**
 * Only `sys_id` and `status` — the rail draws the phase and nothing else, so
 * none of the table's counters are fetched.
 */
const FIELDS = 'sys_id,status';

async function queryJobs(params) {
  const response = await aiuxFetch(`/api/now/table/${JOB_TABLE}?${params}`);
  if (!response.ok) {
    throw new Error(`job query failed: ${response.status}`);
  }
  return (await response.json())?.result ?? [];
}

/**
 * The run the rail should show: the most recent one still in flight, else the
 * most recent of any status, else `null`.
 *
 * @returns {Promise<{sysId: string, status: string} | null>}
 */
export async function fetchCurrentJob() {
  const rows = await queryJobs(
    new URLSearchParams({
      sysparm_query: 'ORDERBYDESCsys_created_on',
      sysparm_fields: FIELDS,
      sysparm_limit: String(SCAN_LIMIT),
      // Raw values, so `status` compares against the stored choice keys above
      // rather than their translated labels.
      sysparm_display_value: 'false'
    })
  );

  const inFlight = rows.find(row => !FINISHED_STATUSES.includes(row.status));
  const job = inFlight ?? rows[0];
  return job ? {sysId: job.sys_id, status: job.status} : null;
}

/**
 * Re-read one run's status by sys_id. Used on every record-watcher message —
 * the AMB payload isn't guaranteed to carry the field, so a message is treated
 * as a signal to re-read rather than as the new value.
 *
 * @returns {Promise<string>} The current status, or `''` if the row is gone.
 */
export async function fetchJobStatus(sysId) {
  const rows = await queryJobs(
    new URLSearchParams({
      sysparm_query: `sys_id=${sysId}`,
      sysparm_fields: FIELDS,
      sysparm_limit: '1',
      sysparm_display_value: 'false'
    })
  );
  return rows[0]?.status ?? '';
}

/**
 * Real per-article status counts for one job -- the rail's position is
 * derived from these (see page.js), not from Job.status, which no longer
 * carries phase information. No GlideAggregate available from client-side
 * Table API calls, so this fetches raw rows and reduces client-side, same
 * approach pages/pipeline/pipeline-data.js already established.
 *
 * @returns {Promise<Record<string, number>>}
 */
export async function fetchJobItemCounts(sysId) {
  const response = await aiuxFetch(
    `/api/now/table/${JOB_ITEM_TABLE}?${new URLSearchParams({
      sysparm_query: `job=${sysId}`,
      sysparm_fields: 'status',
      sysparm_limit: '200',
      sysparm_display_value: 'false'
    })}`
  );
  if (!response.ok) {
    throw new Error(`job item query failed: ${response.status}`);
  }
  const rows = (await response.json())?.result ?? [];
  const counts = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] || 0) + 1;
  }
  return counts;
}
