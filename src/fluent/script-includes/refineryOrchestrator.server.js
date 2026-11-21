var RefineryOrchestrator = Class.create();
RefineryOrchestrator.prototype = {
    initialize: function () {
    },

    type: 'RefineryOrchestrator'
};

// Temporary throttle while this pipeline is being built out -- bump later.
RefineryOrchestrator.MAX_ARTICLES_PER_RUN = 10;

// How many articles go into one pipeline batch -- also the LLM dispatch
// chunk size (one pipeline batch = one LLM dispatch batch, per
// docs/ideas/job-page-status-change.md). Batches progress through
// converting/analyzing/enriching/scoring independently of one another --
// there is no whole-job phase barrier any more (see the file header comment
// below and x_snc_kb_refinery_job_item.now.ts).
RefineryOrchestrator.LLM_BATCH_SIZE = 5;

// Finding types that indicate a genuine content gap worth attempting
// incident-informed enrichment for (excludes broken_link/duplicate, which
// aren't content gaps, and audience_mismatch/too_vague/image_dependent,
// which incident data can't fix).
RefineryOrchestrator.CONTENT_GAP_FINDING_TYPES = [
    'outdated', 'incomplete', 'no_resolution_steps',
    'missing_context', 'no_error_guidance', 'missing_prerequisites'
];

RefineryOrchestrator.DUPLICATE_OVERLAP_THRESHOLD = 0.6;

/**
 * Entry point -- called by the Scheduled Script Execution (no articleSysIds),
 * or by a manual single/multi-article trigger (widgets/pipeline-run-launcher's
 * server action).
 *
 * Rewritten 2026-09-03 around a per-article Job Item (x_snc_kb_refinery_job_item)
 * instead of a single whole-job phase field. Job creation, Job Item creation,
 * and the conversion step all run synchronously, inline, in this one script
 * execution -- there's no queuing primitive in this app (see the doc above),
 * so "queuing a stage" just means: convert a batch, then dispatch its
 * analyzing LLM call and move on to the next batch without waiting for that
 * dispatch's callback. That's what gives different batches (and therefore
 * different articles) genuinely independent, real-time progress: one batch
 * can be enriching while another is still waiting on its analyzing call.
 *
 * Job.status is now coarse (pending/running/completed/completed_with_errors/
 * failed) -- which phase a specific article is actually in lives on its own
 * Job Item row (x_snc_kb_refinery_job_item.status: pending/converting/
 * analyzing/enriching/scoring/completed/failed/skipped). See
 * _checkBatchFinished/_finalizeJob for how the two relate.
 *
 * Only one job may be in flight app-wide at a time (see the guard below) --
 * but a user-initiated run is deliberately exempt from it, via the same
 * `force` flag documented below: unlike the scheduled job (which never
 * passes `force` and is always subject to the guard), a manual run doesn't
 * care whether another job is already in progress. widgets/pipeline-run-
 * launcher's own "Refine articles" button is unconditionally enabled on
 * this basis -- it does not check job status before letting a user open the
 * picker and start a run.
 *
 * @param {string[]} [articleSysIds] - when given, scope the run to exactly
 *   these kb_knowledge sys_ids instead of the usual active/published/
 *   updated-in-2-years batch query.
 * @param {boolean} [force] - when true: (1) bypasses the single-job-in-
 *   flight guard below, so a manual run proceeds even if another job is
 *   already running, and (2) bypasses the unchanged-since-last-run skip in
 *   _prepareAnalysis for every article in this run, reprocessing it even if
 *   its Analysis is already 'ready' with a matching source_updated_on. Both
 *   behaviors share this one flag deliberately -- there is no separate
 *   "run anyway" switch. Only meaningful (and only ever sent) for a manual,
 *   articleSysIds-scoped run -- a user explicitly asking to redo an article
 *   they picked. Not validated against articleSysIds being set: the
 *   scheduled job simply never passes it, so it's always subject to both
 *   the job-lock guard and the unchanged-since-last-run skip.
 * @returns {string|null} the new job's sys_id, or null if the guard applied
 *   (no `force`, and a job was already in progress) or the job record
 *   failed to create.
 */
RefineryOrchestrator.run = function (articleSysIds, force) {
    if (!force) {
        var existing = new GlideRecordSecure('x_snc_kb_refinery_job');
        existing.addQuery('status', 'NOT IN', 'completed,completed_with_errors,failed');
        existing.setLimit(1);
        existing.query();
        if (existing.next()) {
            gs.warn('[Refinery] RefineryOrchestrator.run: a job is already in progress (' + existing.getUniqueValue() + ') - skipping this run.');
            return null;
        }
    }

    var jobGr = new GlideRecordSecure('x_snc_kb_refinery_job');
    jobGr.initialize();
    jobGr.setValue('status', 'pending');
    jobGr.setValue('started_at', new GlideDateTime());
    jobGr.setValue('scope', (articleSysIds && articleSysIds.length)
        ? 'Manual run: ' + articleSysIds.length + ' article(s) selected by ' + gs.getUserDisplayName()
        : 'kb_knowledge: active, published, updated in the last 2 years (limit ' + RefineryOrchestrator.MAX_ARTICLES_PER_RUN + ')');
    jobGr.setValue('triggered_by', gs.getUserID());
    jobGr.setValue('trigger_type', (articleSysIds && articleSysIds.length) ? 'user_initiated' : 'scheduled');
    var jobSysId = jobGr.insert();
    if (!jobSysId) {
        gs.error('[Refinery] RefineryOrchestrator.run: failed to create job record - aborting.');
        return null;
    }

    RefineryOrchestrator._updateJob(jobSysId, { status: 'running' });

    try {
        RefineryOrchestrator._startJob(jobSysId, articleSysIds, force);
    } catch (e) {
        gs.error('[Refinery] RefineryOrchestrator.run: failure starting job: ' + e);
        // Last-resort safety net: whatever Job Items already exist for this
        // job (there may be none yet, if this threw before _startJob even
        // created any) must not be left stuck in a non-terminal status with
        // no further code path ever coming back to them.
        RefineryOrchestrator._failRemainingItems(jobSysId);
        RefineryOrchestrator._updateJob(jobSysId, {
            status: 'failed',
            error_message: String(e).substring(0, 4000),
            completed_at: new GlideDateTime()
        });
    }

    return jobSysId;
};

/**
 * Writes the given fields onto the Job record via its OWN freshly-fetched
 * GlideRecord -- never reuse a GlideRecord across calls/functions for this
 * table. GlideRecord.update() rewrites the record's entire in-memory field
 * snapshot, not just whatever was set() since the last save -- so a
 * long-lived jobGr held across an async-spanning sequence of calls (as this
 * used to be, threaded from run() through _startJob()/_runConversionStage())
 * will silently stomp any field a *different*, concurrently-running script
 * execution (an LLM callback, another batch's own job-record write) already
 * committed in the meantime. Confirmed live: remaining_batches was observed
 * reset back toward its original total mid-run, because _startJob's own
 * per-batch update() kept re-sending its stale in-memory copy of that field
 * over whatever _decrementRemainingBatches had already written concurrently.
 * See kb-refinery-domain.md.
 *
 * @param {string} jobSysId
 * @param {Object} fields - field name -> value to setValue() before update().
 */
RefineryOrchestrator._updateJob = function (jobSysId, fields) {
    var jobGr = new GlideRecordSecure('x_snc_kb_refinery_job');
    if (!jobGr.get(jobSysId)) return;
    for (var field in fields) {
        jobGr.setValue(field, fields[field]);
    }
    jobGr.update();
};

/**
 * Marks every not-yet-terminal Job Item for a job (optionally scoped to one
 * batch) as 'failed'. A last-resort safety net, not a normal code path --
 * called only from a catch block that's already decided something
 * unexpected happened, to guarantee every Job Item still reaches a terminal
 * status even when the specific failure wasn't one this app anticipated.
 *
 * @param {string} jobSysId
 * @param {number} [batchNumber] - when given, only this batch's items.
 */
RefineryOrchestrator._failRemainingItems = function (jobSysId, batchNumber) {
    var gr = new GlideRecordSecure('x_snc_kb_refinery_job_item');
    gr.addQuery('job', jobSysId);
    if (batchNumber !== undefined && batchNumber !== null) {
        gr.addQuery('batch_number', batchNumber);
    }
    gr.addQuery('status', 'NOT IN', 'completed,failed,skipped');
    gr.query();
    while (gr.next()) {
        gr.setValue('status', 'failed');
        gr.update();
    }
};

/**
 * Last-resort safety net for a per-item callback handler that threw for a
 * reason this app didn't anticipate -- guarantees the item still reaches a
 * terminal status rather than getting stuck forever with no further
 * callback ever coming for it. Called from a catch block; must never throw
 * itself, or the same problem it exists to prevent recurs one level up.
 */
RefineryOrchestrator._recoverFromUnhandledError = function (userData, error) {
    try {
        gs.error('[Refinery] Unhandled error processing ' + JSON.stringify(userData) + ': ' + error);
        if (userData && userData.jobItemSysId) {
            RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'failed');
        }
        if (userData && userData.analysisSysId && userData.phase !== 'scoring_raw') {
            var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
            if (analysisGr.get(userData.analysisSysId)) {
                analysisGr.setValue('pipeline_stage', 'failed');
                analysisGr.update();
            }
        }
    } catch (e2) {
        gs.error('[Refinery] _recoverFromUnhandledError: recovery itself failed: ' + e2);
    }
};

/**
 * Queries the articles this job will work on, creates one Job Item per
 * article (status 'pending'), assigns batch numbers (LLM_BATCH_SIZE items
 * per batch), then runs the conversion step for every batch in turn.
 * Dispatching a batch's analyzing call returns immediately, so batches don't
 * wait on one another here -- their later progress is driven independently
 * by whichever LLM callback happens to land first.
 *
 * @param {boolean} [force] - forwarded to _runConversionStage/_prepareAnalysis
 *   for every batch -- see RefineryOrchestrator.run's own doc comment.
 */
RefineryOrchestrator._startJob = function (jobSysId, articleSysIds, force) {
    var kbGr = new GlideRecordSecure('kb_knowledge');

    if (articleSysIds && articleSysIds.length) {
        // A manual run against explicitly-picked articles -- deliberately NOT
        // re-applying addActiveQuery()/workflow_state=published/2-year-window
        // below. Those filters exist to keep an *automatic* batch reasonable;
        // a user who explicitly picked these exact articles has already made
        // that judgment call.
        kbGr.addQuery('sys_id', 'IN', articleSysIds.join(','));
        if (articleSysIds.length > 25) {
            var maxPassSize = parseInt(gs.getProperty('glide.db.first_pass_sys_id_list_size.max', 100));
            if (articleSysIds.length >= maxPassSize) {
                kbGr.disableSysIdInOptimization();
            }
        }
        kbGr.setLimit(articleSysIds.length);
    } else {
        var twoYearsAgo = new GlideDateTime();
        twoYearsAgo.addSeconds(-730 * 24 * 60 * 60);
        kbGr.addActiveQuery();
        kbGr.addQuery('workflow_state', 'published');
        kbGr.addQuery('sys_updated_on', '>=', twoYearsAgo);
        kbGr.setLimit(RefineryOrchestrator.MAX_ARTICLES_PER_RUN);
    }
    kbGr.query();
    RefineryOrchestrator._updateJob(jobSysId, { articles_total: kbGr.getRowCount() });

    // Capture just the sys_ids and release the DB connection before doing any
    // per-article work, per docs/ideas/job-page-status-change.md.
    var kbSysIds = [];
    while (kbGr.next()) {
        kbSysIds.push(kbGr.getUniqueValue());
    }

    var batchNumber = 1;
    var inCurrentBatch = 0;

    for (var i = 0; i < kbSysIds.length; i++) {
        if (inCurrentBatch === RefineryOrchestrator.LLM_BATCH_SIZE) {
            batchNumber++;
            inCurrentBatch = 0;
        }

        var jobItemGr = new GlideRecordSecure('x_snc_kb_refinery_job_item');
        jobItemGr.initialize();
        jobItemGr.setValue('job', jobSysId);
        jobItemGr.setValue('kb_knowledge', kbSysIds[i]);
        jobItemGr.setValue('status', 'pending');
        jobItemGr.setValue('batch_number', batchNumber);
        jobItemGr.insert();

        inCurrentBatch++;
    }

    var totalBatches = kbSysIds.length === 0 ? 0 : batchNumber;
    RefineryOrchestrator._updateJob(jobSysId, { remaining_batches: totalBatches });

    if (totalBatches === 0) {
        // Nothing matched the query at all (articles_total === 0) -- nothing
        // to wait on, finalize immediately.
        RefineryOrchestrator._finalizeJob(jobSysId);
        return;
    }

    for (var b = 1; b <= totalBatches; b++) {
        // _runConversionStage already isolates each of its own items with a
        // per-item try/catch -- this outer one is a second-line safety net
        // for a failure *between* items (e.g. the batch's own query), so one
        // bad batch can't leave every later batch's items stuck at 'pending'
        // forever.
        try {
            RefineryOrchestrator._runConversionStage(jobSysId, b, force);
        } catch (e) {
            gs.error('[Refinery] _startJob: conversion stage for batch ' + b + ' failed unexpectedly: ' + e);
            RefineryOrchestrator._failRemainingItems(jobSysId, b);
            RefineryOrchestrator._checkBatchFinished(jobSysId, b);
        }
    }
};

/**
 * Finds or creates the Analysis row for this article. Returns null when the
 * article is unchanged since it last reached pipeline_stage 'ready' -- the
 * skip-on-rerun check has to run BEFORE source_updated_on/last_job are
 * overwritten for this run, or it would always compare a value against
 * itself.
 *
 * @param {boolean} [force] - when true, reprocess even if alreadyReady would
 *   otherwise skip this article -- see RefineryOrchestrator.run's own doc
 *   comment for where this comes from and when it's set.
 */
RefineryOrchestrator._prepareAnalysis = function (kbGr, jobSysId, force) {
    var kbSysId = kbGr.getUniqueValue();
    var kbUpdatedOn = kbGr.getValue('sys_updated_on');

    var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    analysisGr.addQuery('source_table', 'kb_knowledge');
    analysisGr.addQuery('source_record', kbSysId);
    analysisGr.setLimit(1);
    analysisGr.query();
    var isNew = !analysisGr.next();

    if (!isNew) {
        var alreadyReady = analysisGr.getValue('pipeline_stage') === 'ready'
            && analysisGr.getValue('source_updated_on') === kbUpdatedOn;
        if (alreadyReady && !force) {
            return null;
        }
    } else {
        analysisGr.initialize();
        analysisGr.setValue('source_table', 'kb_knowledge');
        analysisGr.setValue('source_record', kbSysId);
        analysisGr.setValue('source_class', kbGr.getValue('sys_class_name'));
        analysisGr.setValue('kb_knowledge_base', kbGr.getValue('kb_knowledge_base'));
    }

    analysisGr.setValue('source_updated_on', kbUpdatedOn);
    analysisGr.setValue('last_job', jobSysId);
    analysisGr.setValue('pipeline_stage', 'analyzing');

    if (isNew) {
        analysisGr.insert();
    } else {
        analysisGr.update();
        // Only a genuine rerun of an existing Analysis can have prior-job
        // Finding rows to cancel -- a brand-new Analysis has none yet.
        RefineryOrchestrator._cancelPriorFindings(analysisGr.getUniqueValue(), jobSysId);
    }
    return analysisGr;
};

/**
 * Marks every Finding left over from a previous run of this Analysis as
 * 'cancelled'. Called once per rerun, before this run's own analyzing phase
 * has created any Finding rows of its own -- so every row this query
 * touches unambiguously belongs to a prior job.
 *
 * Finding rows are never deleted across reruns (see _queryFindings' own
 * comment above) -- without this, a Finding from an old run keeps sitting
 * at whatever state it was left in (often the 'new' default, or a stale
 * 'remediated'/'acknowledged' from a run that's no longer the current one)
 * even once a fresher run has superseded it. That's confusing in any view
 * that isn't scoped to a specific job -- e.g. pages/pipeline's tunnel
 * detail, which pulls an Analysis' Findings with no job filter at all (see
 * kb-refinery-pages.md).
 */
RefineryOrchestrator._cancelPriorFindings = function (analysisSysId, jobSysId) {
    var gr = new GlideRecordSecure('x_snc_kb_refinery_finding');
    gr.addQuery('parent', analysisSysId);
    gr.addQuery('last_job', '!=', jobSysId);
    gr.addQuery('state', '!=', 'cancelled');
    gr.query();
    while (gr.next()) {
        gr.setValue('state', 'cancelled');
        gr.update();
    }
};

RefineryOrchestrator._findAnalysisFor = function (kbSysId) {
    var gr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    gr.addQuery('source_table', 'kb_knowledge');
    gr.addQuery('source_record', kbSysId);
    gr.setLimit(1);
    gr.query();
    return gr.next() ? gr : null;
};

// ============================================================== Conversion

/**
 * Converts every 'pending' Job Item in this batch (HTML->Markdown, link
 * check, mechanical scoring -- no LLM calls), then dispatches the analyzing
 * batch for whichever ones actually converted. Runs entirely synchronously;
 * the only thing that returns before finishing is the LLM dispatch itself.
 *
 * @param {boolean} [force] - forwarded to _prepareAnalysis for every item in
 *   this batch.
 */
RefineryOrchestrator._runConversionStage = function (jobSysId, batchNumber, force) {
    var itemGr = new GlideRecordSecure('x_snc_kb_refinery_job_item');
    itemGr.addQuery('job', jobSysId);
    itemGr.addQuery('batch_number', batchNumber);
    itemGr.addQuery('status', 'pending');
    itemGr.query();

    var eligible = []; // {jobItemSysId, analysisSysId}

    while (itemGr.next()) {
        var jobItemSysId = itemGr.getUniqueValue();
        itemGr.setValue('status', 'converting');
        itemGr.update();

        // The ENTIRE per-item body is one try/catch, not just
        // _phaseA_converting -- an unexpected throw anywhere in here (the
        // kb_knowledge lookup, _prepareAnalysis, etc.) must still mark this
        // one item failed and move on to the next, rather than aborting the
        // whole batch's while loop and leaving every later item in this
        // batch stuck at 'pending' forever.
        try {
            var kbSysId = itemGr.getValue('kb_knowledge');
            var kbGr = new GlideRecordSecure('kb_knowledge');
            if (!kbGr.get(kbSysId)) {
                gs.error('[Refinery] _runConversionStage: kb_knowledge ' + kbSysId + ' no longer exists.');
                itemGr.setValue('status', 'failed');
                itemGr.update();
                RefineryOrchestrator._increment(jobSysId, 'articles_skipped', 1);
                continue;
            }

            var analysisGr = RefineryOrchestrator._prepareAnalysis(kbGr, jobSysId, force);
            if (!analysisGr) {
                var existingAnalysisGr = RefineryOrchestrator._findAnalysisFor(kbSysId);
                itemGr.setValue('status', 'skipped');
                if (existingAnalysisGr) itemGr.setValue('analysis', existingAnalysisGr.getUniqueValue());
                itemGr.update();
                RefineryOrchestrator._increment(jobSysId, 'articles_skipped', 1);
                continue;
            }

            var analysisSysId = analysisGr.getUniqueValue();
            itemGr.setValue('analysis', analysisSysId);
            itemGr.update();

            RefineryOrchestrator._phaseA_converting(kbGr, analysisGr, jobSysId);
            RefineryOrchestrator._increment(jobSysId, 'articles_processed', 1);
            eligible.push({ jobItemSysId: jobItemSysId, analysisSysId: analysisSysId });
        } catch (e) {
            gs.error('[Refinery] Conversion failed for job item ' + jobItemSysId + ': ' + e);
            itemGr.setValue('status', 'failed');
            itemGr.update();
            RefineryOrchestrator._increment(jobSysId, 'articles_skipped', 1);
        }
    }

    if (eligible.length > 0) {
        RefineryOrchestrator._dispatchAnalyzingBatch(jobSysId, batchNumber, eligible);
    }
    RefineryOrchestrator._checkBatchFinished(jobSysId, batchNumber);
};

RefineryOrchestrator._phaseA_converting = function (kbGr, analysisGr, jobSysId) {
    var title = kbGr.getValue('short_description') || '';
    var rawHtml = kbGr.getValue('text') || '';
    var rawWithTitle = '<h1>' + title + '</h1>\n' + rawHtml;
    var analysisSysId = analysisGr.getUniqueValue();

    // One version number for the raw/converted trio this run writes -- see
    // _nextSnapshotVersion's own doc comment for why this must be computed
    // once, here, and not re-derived at each later async write site.
    var version = RefineryOrchestrator._nextSnapshotVersion(analysisSysId);

    var scorer = new AIReadabilityScorer();

    var rawScored = scorer.score(rawWithTitle, { detail: true });
    RefineryOrchestrator._writeSnapshot(analysisSysId, 'raw', rawWithTitle, rawScored, null, 0, jobSysId, version);

    var markdown = new HTMLToMarkdownLib().translate(rawHtml);
    var brokenLinkCount = RefineryOrchestrator._checkLinks(markdown, analysisSysId, jobSysId);

    var convertedScored = scorer.score(markdown, { detail: true });
    RefineryOrchestrator._writeSnapshot(analysisSysId, 'converted', markdown, convertedScored, null, brokenLinkCount, jobSysId, version);
};

/**
 * Extracts markdown links, HEAD-checks each external one, and creates a
 * broken_link Finding per failure -- no LLM involved ("link checking is
 * cheap," see docs/plan.md). Returns the broken-link count.
 */
RefineryOrchestrator._checkLinks = function (markdown, analysisSysId, jobSysId) {
    var linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
    var seen = {};
    var brokenCount = 0;
    var match;

    while ((match = linkRe.exec(markdown)) !== null) {
        var url = match[1];
        if (!/^https?:\/\//i.test(url) || seen[url]) continue;
        seen[url] = true;

        if (RefineryOrchestrator._headRequestOk(url)) continue;

        brokenCount++;
        var findingGr = new GlideRecordSecure('x_snc_kb_refinery_finding');
        findingGr.initialize();
        findingGr.setValue('parent', analysisSysId);
        findingGr.setValue('type', 'broken_link');
        findingGr.setValue('severity', 'medium');
        findingGr.setValue('detail', 'Link returned a non-success status or failed to resolve.');
        findingGr.setValue('broken_url', url);
        findingGr.setValue('last_job', jobSysId);
        findingGr.insert();
    }

    return brokenCount;
};

RefineryOrchestrator._headRequestOk = function (url) {
    try {
        var request = new sn_ws.RESTMessageV2();
        request.setHttpMethod('HEAD');
        request.setEndpoint(url);
        var response = request.execute();
        var status = response.getStatusCode();
        return status >= 200 && status < 400;
    } catch (e) {
        gs.warn('[Refinery] RefineryOrchestrator._headRequestOk: HEAD request failed for ' + url + ': ' + e);
        return false;
    }
};

/**
 * score/llm_score are conceptually 0-100 (see docs/plan.md), but the SDK's
 * IntegerColumn min/max config is a no-op in this SDK version -- it never
 * makes it into the generated sys_dictionary XML, so there's no platform-level
 * enforcement. Clamp here instead, at every write site.
 * @param {number} value
 * @returns {number|null} an integer in [0, 100], or null if value isn't a finite number.
 */
RefineryOrchestrator._clampScore = function (value) {
    var n = Number(value);
    if (isNaN(n)) return null;
    return Math.min(100, Math.max(0, Math.round(n)));
};

/**
 * @param {string} content
 * @returns {number} the token count for content, via the platform's own
 * tokenizer -- 0 if content is blank or the calculator throws.
 */
RefineryOrchestrator._getTokenCount = function (content) {
    if (!content) return 0;
    try {
        if (!RefineryOrchestrator._tokenCalculator) {
            RefineryOrchestrator._tokenCalculator = new sn_generative_ai.TokenCalculator();
        }
        return RefineryOrchestrator._tokenCalculator.getTokenCount(content) || 0;
    } catch (e) {
        gs.warn('[Refinery] RefineryOrchestrator._getTokenCount: TokenCalculator failed: ' + e);
        return 0;
    }
};

/**
 * @param {string} analysisSysId
 * @param {string} snapshotType - raw|converted|enriched
 * @param {string} content
 * @param {Object|null} scoredResult - an AIReadabilityScorer.score() envelope, or null.
 * @param {number|null} llmScore
 * @param {number} brokenLinkCount
 * @param {string} jobSysId
 * @param {number} version - the pipeline-run number this snapshot belongs to;
 *   see _nextSnapshotVersion/_currentSnapshotVersion.
 * @returns {string|null} the new snapshot's sys_id.
 */
RefineryOrchestrator._writeSnapshot = function (analysisSysId, snapshotType, content, scoredResult, llmScore, brokenLinkCount, jobSysId, version) {
    var snapGr = new GlideRecordSecure('x_snc_kb_refinery_snapshot');
    snapGr.initialize();
    snapGr.setValue('parent', analysisSysId);
    snapGr.setValue('type', snapshotType);
    snapGr.setValue('version', version);
    snapGr.setValue('content', content);

    if (scoredResult && scoredResult.ok) {
        var stats = scoredResult.stats || {};
        snapGr.setValue('score', RefineryOrchestrator._clampScore(scoredResult.score));
        snapGr.setValue('word_count', stats.words || 0);
        snapGr.setValue('image_count', stats.images || 0);
        snapGr.setValue('link_count', stats.links || 0);
    } else if (scoredResult && scoredResult.error) {
        snapGr.setValue('processing_message', 'AIReadabilityScorer: ' + scoredResult.error.message);
    }

    if (llmScore !== null && llmScore !== undefined) {
        snapGr.setValue('llm_score', RefineryOrchestrator._clampScore(llmScore));
    }
    snapGr.setValue('token_count', RefineryOrchestrator._getTokenCount(content));
    snapGr.setValue('broken_link_count', brokenLinkCount || 0);
    snapGr.setValue('processed_at', new GlideDateTime());
    snapGr.setValue('last_job', jobSysId);
    return snapGr.insert();
};

RefineryOrchestrator._latestSnapshot = function (analysisSysId, snapshotType) {
    var gr = new GlideRecordSecure('x_snc_kb_refinery_snapshot');
    gr.addQuery('parent', analysisSysId);
    gr.addQuery('type', snapshotType);
    gr.orderByDesc('processed_at');
    gr.setLimit(1);
    gr.query();
    return gr.next() ? gr : null;
};

/**
 * Counts this Analysis' existing 'raw' Snapshots and returns count + 1 -- the
 * version number for the raw/converted/enriched trio the run that's about to
 * start will write. Call once per run (from _phaseA_converting, before the
 * raw Snapshot is written) and reuse the same value for that run's converted
 * write; the later, async enriched write sites can't call this directly --
 * by the time they run, this run's own raw row already exists and would
 * inflate the count -- see _currentSnapshotVersion instead.
 */
RefineryOrchestrator._nextSnapshotVersion = function (analysisSysId) {
    var ga = new GlideAggregate('x_snc_kb_refinery_snapshot');
    ga.addQuery('parent', analysisSysId);
    ga.addQuery('type', 'raw');
    ga.addAggregate('COUNT');
    ga.query();
    var count = ga.next() ? (parseInt(ga.getAggregate('COUNT'), 10) || 0) : 0;
    return count + 1;
};

/**
 * Reads back the version number of this run's own raw Snapshot for
 * `analysisSysId` -- used by the enriched write sites (the enriching
 * result's skip branch, _handleRescoringResult), which run in a later,
 * separate script execution with no memory of the version
 * _phaseA_converting computed when this run started. Safe to read off the
 * *latest* raw Snapshot because RefineryOrchestrator.run()'s job-lock guard
 * never allows a second run to start for the same Analysis while one is
 * still in flight.
 */
RefineryOrchestrator._currentSnapshotVersion = function (analysisSysId) {
    var rawGr = RefineryOrchestrator._latestSnapshot(analysisSysId, 'raw');
    return rawGr ? (parseInt(rawGr.getValue('version'), 10) || 1) : 1;
};

RefineryOrchestrator._recordProcessingMessage = function (analysisSysId, snapshotType, message) {
    var gr = RefineryOrchestrator._latestSnapshot(analysisSysId, snapshotType);
    if (!gr) return;
    gr.setValue('processing_message', message.substring(0, 4000));
    gr.update();
};

/**
 * Adds `amount` to a Job field via its OWN freshly-fetched GlideRecord --
 * see _updateJob's own doc comment for why every Job-record write in this
 * file fetches fresh rather than reusing a GlideRecord across calls.
 */
RefineryOrchestrator._increment = function (jobSysId, field, amount) {
    var jobGr = new GlideRecordSecure('x_snc_kb_refinery_job');
    if (!jobGr.get(jobSysId)) return;
    jobGr.setValue(field, (parseInt(jobGr.getValue(field), 10) || 0) + amount);
    jobGr.update();
};

RefineryOrchestrator._safeParseArray = function (raw) {
    try {
        var parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
};

RefineryOrchestrator._safeParseObject = function (raw) {
    try {
        var parsed = JSON.parse(raw || '{}');
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
        return {};
    }
};

/**
 * Content-gap findings only -- the six types incident data could plausibly
 * close. This is what gates the enriching side-channel; the rewrite dispatch
 * wants _allFindings instead, since structural/markup/media defects are
 * exactly what it repairs and no incident can help with any of them.
 *
 * @param {string} analysisSysId
 * @param {string} [jobSysId] - scope to one job's findings. Analysis records
 *   are reused across runs (see _prepareAnalysis) and Finding rows are never
 *   deleted, so without this a re-processed article accumulates every prior
 *   run's findings -- including ones already fixed -- into the prompt.
 */
RefineryOrchestrator._gapFindings = function (analysisSysId, jobSysId) {
    return RefineryOrchestrator._queryFindings(
        analysisSysId, jobSysId, RefineryOrchestrator.CONTENT_GAP_FINDING_TYPES);
};

/** Every finding for this analysis (optionally this job), whatever its type. */
RefineryOrchestrator._allFindings = function (analysisSysId, jobSysId) {
    return RefineryOrchestrator._queryFindings(analysisSysId, jobSysId, null);
};

RefineryOrchestrator._queryFindings = function (analysisSysId, jobSysId, types) {
    var gr = new GlideRecordSecure('x_snc_kb_refinery_finding');
    gr.addQuery('parent', analysisSysId);
    if (types) gr.addQuery('type', 'IN', types.join(','));
    if (jobSysId) gr.addQuery('last_job', jobSysId);
    gr.orderBy('type');
    gr.query();

    var out = [];
    while (gr.next()) {
        out.push({ sysId: gr.getUniqueValue(), type: gr.getValue('type'), detail: gr.getValue('detail') });
    }
    return out;
};

RefineryOrchestrator._findingsToText = function (findings) {
    var lines = [];
    for (var i = 0; i < findings.length; i++) {
        lines.push('- [' + findings[i].type + '] ' + findings[i].detail);
    }
    return lines.length ? lines.join('\n') : '(none)';
};

/**
 * Same rendering as _findingsToText, but prefixes each line with a short,
 * stable label (F1, F2, ...) and returns a label->sys_id index alongside the
 * text -- lets a later async callback (_handleRescoringResult) resolve which
 * real Finding record(s) the model marked resolved/unresolved, the same
 * "hand the model a short opaque key, resolve it back to a sys_id via an
 * index carried in userData" pattern _buildEnrichingItem already uses for
 * incidentIndex. Only Call 3 (article_synthesis) needs this -- Call 2 never
 * reports back which findings it touched, so it keeps using the plain
 * _findingsToText above.
 */
RefineryOrchestrator._indexedFindingsToText = function (findings) {
    var lines = [];
    var index = {};
    for (var i = 0; i < findings.length; i++) {
        var label = 'F' + (i + 1);
        lines.push('- [' + label + '] [' + findings[i].type + '] ' + findings[i].detail);
        index[label] = findings[i].sysId;
    }
    return { text: lines.length ? lines.join('\n') : '(none)', index: index };
};

/**
 * Renders Call 2's ai_ready_knowledge as markdown for Call 3's prompt.
 *
 * Call 3 asks for prose and structured steps, so handing it JSON.stringify's
 * output worked directly against its own instruction not to append raw
 * JSON. Tolerates both the current object-per-entry shape and an older
 * bare-string shape, so a knowledge blob written by a previous version of
 * the enrichment prompt still renders.
 */
RefineryOrchestrator._knowledgeToText = function (knowledge) {
    if (!knowledge || typeof knowledge !== 'object') return '(none)';

    var sections = [
        { key: 'conditions', label: 'Conditions (when this applies)', field: 'condition' },
        { key: 'prerequisites', label: 'Prerequisites', field: 'prerequisite' },
        { key: 'actions', label: 'Actions (in order)', field: 'step' },
        { key: 'escalation_criteria', label: 'Escalation criteria', field: 'criterion' }
    ];

    var out = [];
    for (var s = 0; s < sections.length; s++) {
        var list = knowledge[sections[s].key];
        if (!list || !list.length) continue;

        out.push('### ' + sections[s].label);
        for (var i = 0; i < list.length; i++) {
            var entry = list[i];
            if (typeof entry === 'string') {
                out.push('- ' + entry);
                continue;
            }
            if (!entry || typeof entry !== 'object') continue;

            var bullet = '- ' + (entry[sections[s].field] || '');
            var suffix = RefineryOrchestrator._sourceSuffix(entry.source_incidents);
            out.push(bullet + suffix);

            if (entry.expected_result) out.push('  - Expected result: ' + entry.expected_result);
            if (entry.on_failure) out.push('  - If it fails: ' + entry.on_failure);
            if (entry.route_to) out.push('  - Route to: ' + entry.route_to);
        }
        out.push('');
    }

    return out.length ? out.join('\n').replace(/\n+$/, '') : '(none)';
};

/** Renders Call 2's `contradictions` array as markdown for Call 3's prompt. */
RefineryOrchestrator._contradictionsToText = function (contradictions) {
    if (!contradictions || !contradictions.length) return '(none)';

    var out = [];
    for (var i = 0; i < contradictions.length; i++) {
        var c = contradictions[i] || {};
        if (typeof c === 'string') { out.push('- ' + c); continue; }
        out.push('- The article says: ' + (c.article_statement || '(unspecified)'));
        out.push('  - The incidents show: ' + (c.incident_evidence || '(unspecified)')
            + RefineryOrchestrator._sourceSuffix(c.source_incidents));
    }
    return out.join('\n');
};

RefineryOrchestrator._sourceSuffix = function (sourceIncidents) {
    return (sourceIncidents && sourceIncidents.length)
        ? ' [from ' + sourceIncidents.join(', ') + ']'
        : '';
};

// ============================================================ Dispatching

/**
 * Dispatches an executionRequests batch, or -- if the dispatch call itself
 * throws -- routes every item through handleBatchFailure the same way a
 * processErrored callback would, since no callback will ever arrive for it.
 */
RefineryOrchestrator._dispatchOrFail = function (items) {
    if (!items || items.length === 0) return;
    try {
        RefineryLLM.dispatchBatch(items);
    } catch (e) {
        gs.error('[Refinery] _dispatchOrFail: dispatch failed: ' + e.message);
        for (var i = 0; i < items.length; i++) {
            // Each item's own failure handling is isolated -- one bad
            // handleBatchFailure call (itself unexpected) must not prevent
            // every other item in this same batch from being marked failed.
            try {
                RefineryOrchestrator.handleBatchFailure(items[i].userData, 'dispatch failed: ' + e.message);
            } catch (e2) {
                RefineryOrchestrator._recoverFromUnhandledError(items[i].userData, e2);
            }
        }
    }
};

/**
 * Scratch accumulator for "what should this callback dispatch next," valid
 * only within one script execution (see _queueForDispatch/onBatchItemsResolved).
 * A single RefineryLLMCallback.processCompleted call can resolve several
 * items (potentially from several distinct work items) before anything gets
 * dispatched again -- this collects them all into one real batch per
 * (job, batch, next phase) instead of firing one dispatch per item.
 */
RefineryOrchestrator._pendingDispatch = {};

RefineryOrchestrator._queueForDispatch = function (jobSysId, batchNumber, nextPhase, item) {
    var key = jobSysId + ':' + batchNumber + ':' + nextPhase;
    if (!RefineryOrchestrator._pendingDispatch[key]) RefineryOrchestrator._pendingDispatch[key] = [];
    RefineryOrchestrator._pendingDispatch[key].push(item);
};

/**
 * Marks a Job Item's status. Fetches by sys_id -- used from callback-side
 * handlers, which don't have an already-open GlideRecordSecure the way the
 * synchronous conversion loop does.
 */
RefineryOrchestrator._markJobItemStatus = function (jobItemSysId, status) {
    if (!jobItemSysId) return;
    var gr = new GlideRecordSecure('x_snc_kb_refinery_job_item');
    if (!gr.get(jobItemSysId)) return;
    gr.setValue('status', status);
    gr.update();
};

RefineryOrchestrator._dispatchAnalyzingBatch = function (jobSysId, batchNumber, eligibleItems) {
    var items = [];
    for (var i = 0; i < eligibleItems.length; i++) {
        var entry = eligibleItems[i];

        // The ENTIRE per-entry body is one try/catch, including the initial
        // status write -- one entry's failure anywhere in here must not
        // prevent every other entry in this batch from being dispatched.
        try {
            RefineryOrchestrator._markJobItemStatus(entry.jobItemSysId, 'analyzing');

            var built = [
                RefineryOrchestrator._buildAnalyzingItem(jobSysId, batchNumber, entry),
                RefineryOrchestrator._buildRawScoringItem(jobSysId, batchNumber, entry)
            ].filter(Boolean);

            if (built.length === 0) {
                // Missing snapshot data -- nothing will ever be dispatched
                // for this item, so nothing will ever call back for it either.
                RefineryOrchestrator._markJobItemStatus(entry.jobItemSysId, 'failed');
                continue;
            }
            for (var k = 0; k < built.length; k++) items.push(built[k]);
        } catch (e) {
            gs.error('[Refinery] _dispatchAnalyzingBatch: failed to build dispatch item for job item ' + entry.jobItemSysId + ': ' + e);
            RefineryOrchestrator._markJobItemStatus(entry.jobItemSysId, 'failed');
        }
    }

    RefineryOrchestrator._dispatchOrFail(items);
};

// ============================================================== Analyzing

RefineryOrchestrator._buildAnalyzingItem = function (jobSysId, batchNumber, entry) {
    var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    if (!analysisGr.get(entry.analysisSysId)) return null;

    var convertedGr = RefineryOrchestrator._latestSnapshot(entry.analysisSysId, 'converted');
    if (!convertedGr) return null;

    var kbGr = new GlideRecordSecure(analysisGr.getValue('source_table'));
    if (!kbGr.get(analysisGr.getValue('source_record'))) return null;

    var prompt = RefineryPromptTemplate.render('kb_article_analysis', {
        title: kbGr.getValue('short_description'),
        articletype: kbGr.getValue('article_type'),
        kbname: analysisGr.getDisplayValue('kb_knowledge_base'),
        lastupdated: kbGr.getDisplayValue('sys_updated_on'),
        currentdate: new GlideDateTime().getDisplayValue(),
        content: convertedGr.getValue('content')
    });

    return {
        promptText: prompt,
        userData: {
            jobSysId: jobSysId, batchNumber: batchNumber, jobItemSysId: entry.jobItemSysId,
            phase: 'analyzing', analysisSysId: entry.analysisSysId
        }
    };
};

/**
 * A second, genuinely separate LLM call scoring the RAW HTML content -- the
 * exact same `kb_article_analysis` prompt _buildAnalyzingItem uses (not a
 * differently-worded one), just fed the raw snapshot's content instead of
 * converted's. Reusing the identical prompt is deliberate: raw/converted/
 * enriched need to be scored by the same rubric, asked the same way, or the
 * three llm_scores aren't actually comparable -- see docs/plan.md's "LLM
 * Calls" section and docs/prompts/KB Article Analysis.md. Only quality_score
 * is kept from this call's response; the findings/search_terms/etc. it also
 * produces are discarded (see _handleRawScoringResult) -- those describe the
 * *converted* content's current state, not raw's.
 *
 * Tagged with its own `phase: 'scoring_raw'` in userData purely for callback
 * routing (see handleBatchResult) -- this never gates a Job Item's own
 * status, since it's comparison-only.
 */
RefineryOrchestrator._buildRawScoringItem = function (jobSysId, batchNumber, entry) {
    var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    if (!analysisGr.get(entry.analysisSysId)) return null;

    var rawGr = RefineryOrchestrator._latestSnapshot(entry.analysisSysId, 'raw');
    if (!rawGr) return null;

    var kbGr = new GlideRecordSecure(analysisGr.getValue('source_table'));
    if (!kbGr.get(analysisGr.getValue('source_record'))) return null;

    var prompt = RefineryPromptTemplate.render('kb_article_analysis', {
        title: kbGr.getValue('short_description'),
        articletype: kbGr.getValue('article_type'),
        kbname: analysisGr.getDisplayValue('kb_knowledge_base'),
        lastupdated: kbGr.getDisplayValue('sys_updated_on'),
        currentdate: new GlideDateTime().getDisplayValue(),
        content: rawGr.getValue('content')
    });

    return {
        promptText: prompt,
        userData: {
            jobSysId: jobSysId, batchNumber: batchNumber, jobItemSysId: entry.jobItemSysId,
            phase: 'scoring_raw', analysisSysId: entry.analysisSysId
        }
    };
};

// ================================================== Deduplication (side-channel)

/**
 * Runs alongside analyzing (folded in per docs/ideas/job-page-status-change.md)
 * rather than as its own whole-job phase -- compares this article against
 * every OTHER Job Item in the same job that has already been analyzed,
 * regardless of which batch it belongs to, and dispatches a
 * duplicate_confirmation call per new candidate pair. Purely a side-channel:
 * it creates duplicate Findings on both sides when confirmed, but never
 * gates or delays this item's own status progression.
 */
RefineryOrchestrator._checkForDuplicates = function (userData) {
    var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    if (!analysisGr.get(userData.analysisSysId)) return;

    var kbBase = analysisGr.getValue('kb_knowledge_base');
    if (!kbBase) return;
    var terms = RefineryOrchestrator._safeParseArray(analysisGr.getValue('search_terms'));
    if (!terms.length) return;

    var candidatesGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    candidatesGr.addQuery('last_job', userData.jobSysId);
    candidatesGr.addQuery('kb_knowledge_base', kbBase);
    candidatesGr.addQuery('sys_id', '!=', userData.analysisSysId);
    candidatesGr.addNotNullQuery('search_terms');
    candidatesGr.query();

    var items = [];
    while (candidatesGr.next()) {
        var candidateSysId = candidatesGr.getUniqueValue();
        var otherTerms = RefineryOrchestrator._safeParseArray(candidatesGr.getValue('search_terms'));
        if (RefineryOrchestrator._termOverlap(terms, otherTerms) < RefineryOrchestrator.DUPLICATE_OVERLAP_THRESHOLD) continue;
        if (RefineryOrchestrator._duplicateAlreadyFlagged(userData.analysisSysId, candidateSysId)) continue;

        var built = RefineryOrchestrator._buildDeduplicatingItem(userData.jobSysId, { a: userData.analysisSysId, b: candidateSysId });
        if (built) items.push(built);
    }

    RefineryOrchestrator._dispatchOrFail(items);
};

/**
 * Best-effort guard against re-dispatching the same pair from both sides, as
 * each side's own analyzing result lands independently and re-runs this
 * check -- looks for an already-recorded 'duplicate' Finding between the
 * two. Doesn't close the narrower race where both sides land close enough
 * together that neither has a Finding yet; accepted as a rare, low-impact
 * residual (at worst one extra LLM call and a duplicate Finding row for that
 * pair) rather than building a real cross-item lock for it.
 */
RefineryOrchestrator._duplicateAlreadyFlagged = function (analysisSysIdA, analysisSysIdB) {
    var gr = new GlideRecordSecure('x_snc_kb_refinery_finding');
    gr.addQuery('type', 'duplicate');
    gr.addQuery('parent', analysisSysIdA);
    gr.addQuery('related_article', analysisSysIdB);
    gr.setLimit(1);
    gr.query();
    return gr.next();
};

RefineryOrchestrator._termOverlap = function (termsA, termsB) {
    if (!termsA.length || !termsB.length) return 0;

    var setB = {};
    for (var i = 0; i < termsB.length; i++) {
        setB[String(termsB[i]).toLowerCase()] = true;
    }

    var matches = 0;
    for (var j = 0; j < termsA.length; j++) {
        if (setB[String(termsA[j]).toLowerCase()]) matches++;
    }
    return matches / Math.min(termsA.length, termsB.length);
};

RefineryOrchestrator._buildDeduplicatingItem = function (jobSysId, pair) {
    var aGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    var bGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    if (!aGr.get(pair.a) || !bGr.get(pair.b)) return null;

    var prompt = RefineryPromptTemplate.render('duplicate_confirmation', {
        summary_a: aGr.getValue('standardized_summary') || '',
        terms_a: RefineryOrchestrator._safeParseArray(aGr.getValue('search_terms')).join(', '),
        summary_b: bGr.getValue('standardized_summary') || '',
        terms_b: RefineryOrchestrator._safeParseArray(bGr.getValue('search_terms')).join(', ')
    });

    return {
        promptText: prompt,
        userData: { jobSysId: jobSysId, phase: 'deduplicating', analysisSysIdA: pair.a, analysisSysIdB: pair.b }
    };
};

// ============================================================== Enriching

RefineryOrchestrator._buildEnrichingItem = function (jobSysId, batchNumber, entry) {
    var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    if (!analysisGr.get(entry.analysisSysId)) return null;

    var kbGr = new GlideRecordSecure(analysisGr.getValue('source_table'));
    if (!kbGr.get(analysisGr.getValue('source_record'))) return null;

    var convertedGr = RefineryOrchestrator._latestSnapshot(entry.analysisSysId, 'converted');
    if (!convertedGr) return null;

    var gapFindings = RefineryOrchestrator._gapFindings(entry.analysisSysId, jobSysId);
    var searchTerms = RefineryOrchestrator._safeParseArray(analysisGr.getValue('search_terms'));

    var kbCategory = kbGr.getValue('category');
    gs.info('[Refinery][Enrich] analysis=' + entry.analysisSysId + ' kb=' + kbGr.getUniqueValue()
        + ' category="' + kbCategory + '" searchTerms=' + JSON.stringify(searchTerms)
        + ' gapFindings=' + gapFindings.length);

    var incidents = RefineryIncidentSearch.findCandidates(kbCategory, searchTerms);
    gs.info('[Refinery][Enrich] analysis=' + entry.analysisSysId + ' candidate incidents found: '
        + incidents.length + (incidents.length ? (' -> ' + incidents.map(function (inc) { return inc.number; }).join(', ')) : ''));

    var incidentsText = [];
    // Compact lookup, not the full incident objects -- enough to resolve
    // Call 2's own incident_id (sys_id or number) back to a sys_id once the
    // result comes back; the full incident text doesn't need to survive the
    // async boundary since it's already baked into the prompt below.
    var incidentIndex = {};
    for (var i = 0; i < incidents.length; i++) {
        incidentsText.push('- ' + incidents[i].number + ': ' + incidents[i].short_description + ' | Resolution: ' + incidents[i].close_notes);
        incidentIndex[incidents[i].number] = incidents[i].sys_id;
        incidentIndex[incidents[i].sys_id] = incidents[i].sys_id;
    }

    var prompt = RefineryPromptTemplate.render('incident_enrichment', {
        title: kbGr.getValue('short_description'),
        kbname: analysisGr.getDisplayValue('kb_knowledge_base'),
        targetaudience: analysisGr.getValue('target_audience'),
        qualityscore: convertedGr.getValue('llm_score'),
        markdowncontent: convertedGr.getValue('content'),
        findings: RefineryOrchestrator._findingsToText(gapFindings),
        incidents: incidentsText.length ? incidentsText.join('\n') : '(none found)'
    });

    gs.info('[Refinery][Enrich] analysis=' + entry.analysisSysId + ' prompt sent to LLM (first 4000 chars): '
        + prompt.substring(0, 4000));

    return {
        promptText: prompt,
        userData: {
            jobSysId: jobSysId,
            batchNumber: batchNumber,
            jobItemSysId: entry.jobItemSysId,
            phase: 'enriching',
            analysisSysId: entry.analysisSysId,
            gapFindingSysId: gapFindings[0] ? gapFindings[0].sysId : null,
            incidentIndex: incidentIndex,
            // How many candidate incidents were even sent to the LLM -- lets
            // the skip message distinguish "found zero incidents at all"
            // from "found some, none usable" if it's ever needed again.
            incidentCount: incidents.length
        }
    };
};

/**
 * Call 3 (article_synthesis) -- the rewrite itself.
 *
 * Gets ALL of this job's findings, not just the content-gap subset: the gap
 * filter exists so Call 2 only considers gaps incidents could close, and
 * reusing it here would hide every structural, markup, media and
 * anchor-text finding from the one pass able to repair them. Also gets the
 * article's own metadata -- the prompt is told to keep the article's title,
 * and the converted snapshot has no <h1> to read it from (only the raw
 * snapshot gets one prepended, see _phaseA_converting).
 */
RefineryOrchestrator._buildRescoringItem = function (jobSysId, batchNumber, entry) {
    var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    if (!analysisGr.get(entry.analysisSysId)) return null;

    var kbGr = new GlideRecordSecure(analysisGr.getValue('source_table'));
    if (!kbGr.get(analysisGr.getValue('source_record'))) return null;

    var convertedGr = RefineryOrchestrator._latestSnapshot(entry.analysisSysId, 'converted');
    if (!convertedGr) return null;

    var enrichmentKnowledge = RefineryOrchestrator._safeParseObject(analysisGr.getValue('enrichment_knowledge'));
    var recommendations = enrichmentKnowledge.recommendations || [];

    var indexedFindings = RefineryOrchestrator._indexedFindingsToText(
        RefineryOrchestrator._allFindings(entry.analysisSysId, jobSysId));

    var prompt = RefineryPromptTemplate.render('article_synthesis', {
        title: kbGr.getValue('short_description'),
        articletype: kbGr.getValue('article_type'),
        kbname: analysisGr.getDisplayValue('kb_knowledge_base'),
        targetaudience: analysisGr.getValue('target_audience'),
        currentdate: new GlideDateTime().getDisplayValue(),
        original_content: convertedGr.getValue('content'),
        findings: indexedFindings.text,
        ai_ready_knowledge: RefineryOrchestrator._knowledgeToText(enrichmentKnowledge.ai_ready_knowledge),
        contradictions: RefineryOrchestrator._contradictionsToText(enrichmentKnowledge.contradictions),
        recommendations: recommendations.length ? '- ' + recommendations.join('\n- ') : '(none)'
    });

    return {
        promptText: prompt,
        userData: {
            jobSysId: jobSysId, batchNumber: batchNumber, jobItemSysId: entry.jobItemSysId,
            phase: 'rescoring', analysisSysId: entry.analysisSysId,
            // Label -> Finding.sys_id, so _handleRescoringResult can turn the
            // model's resolved_finding_ids/unresolved_gaps labels back into
            // real records to update -- see _indexedFindingsToText.
            findingIndex: indexedFindings.index
        }
    };
};

/**
 * The literal `kb_article_analysis` prompt again, this time against the
 * rewritten `enriched_content` _buildRescoringItem's LLM call produced --
 * the same "same call, different content" treatment _buildRawScoringItem
 * gives raw, so all three of raw/converted/enriched are scored identically.
 * Only quality_score is kept (see _handleEnrichedScoringResult); Call 3
 * (article_synthesis) deliberately no longer self-scores its own rewrite --
 * see that prompt's own comments for why.
 */
RefineryOrchestrator._buildEnrichedScoringItem = function (jobSysId, batchNumber, entry) {
    var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    if (!analysisGr.get(entry.analysisSysId)) return null;

    var kbGr = new GlideRecordSecure(analysisGr.getValue('source_table'));
    if (!kbGr.get(analysisGr.getValue('source_record'))) return null;

    var enrichedGr = RefineryOrchestrator._latestSnapshot(entry.analysisSysId, 'enriched');
    if (!enrichedGr) return null;

    var prompt = RefineryPromptTemplate.render('kb_article_analysis', {
        title: kbGr.getValue('short_description'),
        articletype: kbGr.getValue('article_type'),
        kbname: analysisGr.getDisplayValue('kb_knowledge_base'),
        lastupdated: kbGr.getDisplayValue('sys_updated_on'),
        currentdate: new GlideDateTime().getDisplayValue(),
        content: enrichedGr.getValue('content')
    });

    return {
        promptText: prompt,
        userData: {
            jobSysId: jobSysId, batchNumber: batchNumber, jobItemSysId: entry.jobItemSysId,
            phase: 'scoring_enriched', analysisSysId: entry.analysisSysId
        }
    };
};

// ============================================== Callback-side persistence

/** Called by RefineryLLMCallback once per resolved item -- phase dispatch. */
RefineryOrchestrator.handleBatchResult = function (userData, parsedJson) {
    if (userData.phase === 'analyzing') return RefineryOrchestrator._handleAnalyzingResult(userData, parsedJson);
    if (userData.phase === 'scoring_raw') return RefineryOrchestrator._handleRawScoringResult(userData, parsedJson);
    if (userData.phase === 'deduplicating') return RefineryOrchestrator._handleDeduplicatingResult(userData, parsedJson);
    if (userData.phase === 'enriching') return RefineryOrchestrator._handleEnrichingResult(userData, parsedJson);
    if (userData.phase === 'rescoring') return RefineryOrchestrator._handleRescoringResult(userData, parsedJson);
    if (userData.phase === 'scoring_enriched') return RefineryOrchestrator._handleEnrichedScoringResult(userData, parsedJson);
    gs.warn('[Refinery] RefineryOrchestrator.handleBatchResult: unknown phase in user_data: ' + JSON.stringify(userData));
};

/**
 * Folds Call 1's `location` (which section) and `evidence` (the offending
 * text, quoted) into the single Finding.detail field.
 *
 * These two are what make a finding repairable by Call 3 without re-deriving
 * it -- they're the reason the rewrite prompt doesn't need
 * AIReadabilityScorer's own findings piped into it. Folded rather than given
 * their own columns to keep the Finding schema unchanged; promote them to
 * real columns if anything ever needs to report or filter on them.
 */
RefineryOrchestrator._findingDetail = function (finding) {
    var detail = String(finding.detail || '');
    var location = String(finding.location || '').trim();
    var evidence = String(finding.evidence || '').trim();

    if (location && location !== '(document)') detail += ' (at: ' + location + ')';
    if (evidence) detail += ' Offending text: "' + evidence + '"';

    return detail.substring(0, 4000);
};

RefineryOrchestrator._handleAnalyzingResult = function (userData, result) {
    var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    if (!analysisGr.get(userData.analysisSysId)) {
        gs.error('[Refinery] _handleAnalyzingResult: analysis ' + userData.analysisSysId + ' no longer exists.');
        RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'failed');
        return;
    }

    var convertedGr = RefineryOrchestrator._latestSnapshot(userData.analysisSysId, 'converted');
    if (!convertedGr) {
        gs.error('[Refinery] _handleAnalyzingResult: no converted snapshot for analysis ' + userData.analysisSysId + '.');
        RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'failed');
        return;
    }

    analysisGr.setValue('standardized_summary', result.standardized_summary || result.summary || '');
    analysisGr.setValue('search_terms', JSON.stringify(result.search_terms || []));
    analysisGr.setValue('target_audience', result.target_audience || '');
    analysisGr.update();

    convertedGr.setValue('llm_score', RefineryOrchestrator._clampScore(result.quality_score || 0));
    convertedGr.update();

    var findings = result.findings || [];
    for (var i = 0; i < findings.length; i++) {
        var findingGr = new GlideRecordSecure('x_snc_kb_refinery_finding');
        findingGr.initialize();
        findingGr.setValue('parent', userData.analysisSysId);
        findingGr.setValue('type', findings[i].type);
        findingGr.setValue('severity', findings[i].severity || 'medium');
        findingGr.setValue('detail', RefineryOrchestrator._findingDetail(findings[i]));
        findingGr.setValue('last_job', userData.jobSysId);
        findingGr.insert();
    }
    if (findings.length) {
        RefineryOrchestrator._increment(userData.jobSysId, 'findings_generated', findings.length);
    }

    RefineryOrchestrator._recordProductMentions(userData.analysisSysId, result.product_mentions || []);

    // Side-channel -- never gates this item's own status below. Isolated in
    // its own try/catch for exactly that reason: an unexpected throw in here
    // must not prevent the actual status transition below from running.
    try {
        RefineryOrchestrator._checkForDuplicates(userData);
    } catch (e) {
        gs.error('[Refinery] _checkForDuplicates failed (non-fatal, dedup is a side-channel): ' + e);
    }

    var gapFindings = RefineryOrchestrator._gapFindings(userData.analysisSysId, userData.jobSysId);
    if (gapFindings.length === 0) {
        // Nothing to enrich -- this article is done. Real, persisted outcome
        // now instead of pages/pipeline's old client-side "no_gaps" guess.
        RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'completed');
        return;
    }

    RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'enriching');
    var enrichItem = RefineryOrchestrator._buildEnrichingItem(userData.jobSysId, userData.batchNumber, {
        jobItemSysId: userData.jobItemSysId, analysisSysId: userData.analysisSysId
    });
    if (enrichItem) {
        RefineryOrchestrator._queueForDispatch(userData.jobSysId, userData.batchNumber, 'enriching', enrichItem);
    } else {
        RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'failed');
    }
};

/** Writes the raw-content-only quality_score from _buildRawScoringItem's LLM call onto the raw snapshot. */
RefineryOrchestrator._handleRawScoringResult = function (userData, result) {
    var rawGr = RefineryOrchestrator._latestSnapshot(userData.analysisSysId, 'raw');
    if (!rawGr) return;
    rawGr.setValue('llm_score', RefineryOrchestrator._clampScore(result.quality_score || 0));
    rawGr.update();
};

RefineryOrchestrator._recordProductMentions = function (analysisSysId, productNames) {
    for (var i = 0; i < productNames.length; i++) {
        var name = String(productNames[i] || '').trim();
        if (!name) continue;

        var productGr = new GlideRecordSecure('x_snc_kb_refinery_product');
        productGr.addQuery('name', name);
        productGr.setLimit(1);
        productGr.query();
        var isNewProduct = !productGr.next();
        if (isNewProduct) {
            productGr.initialize();
            productGr.setValue('name', name);
            productGr.insert();
        }
        var productSysId = productGr.getUniqueValue();

        var mentionGr = new GlideRecordSecure('x_snc_kb_refinery_mention');
        mentionGr.addQuery('analysis', analysisSysId);
        mentionGr.addQuery('product', productSysId);
        mentionGr.setLimit(1);
        mentionGr.query();

        if (mentionGr.next()) {
            mentionGr.setValue('mention_count', (parseInt(mentionGr.getValue('mention_count'), 10) || 0) + 1);
            mentionGr.update();
        } else {
            mentionGr.initialize();
            mentionGr.setValue('analysis', analysisSysId);
            mentionGr.setValue('product', productSysId);
            mentionGr.setValue('mention_count', 1);
            mentionGr.insert();

            productGr.setValue('article_count', (parseInt(productGr.getValue('article_count'), 10) || 0) + 1);
            productGr.update();
        }
    }
};

RefineryOrchestrator._handleDeduplicatingResult = function (userData, result) {
    if (!result.same_topic) return;

    var primarySysId = result.more_complete_article === 'b' ? userData.analysisSysIdB : userData.analysisSysIdA;
    RefineryOrchestrator._createDuplicateFinding(userData.analysisSysIdA, userData.analysisSysIdB, primarySysId, userData.jobSysId);
    RefineryOrchestrator._createDuplicateFinding(userData.analysisSysIdB, userData.analysisSysIdA, primarySysId, userData.jobSysId);
    RefineryOrchestrator._increment(userData.jobSysId, 'duplicates_found', 1);
    RefineryOrchestrator._increment(userData.jobSysId, 'findings_generated', 2);
};

RefineryOrchestrator._createDuplicateFinding = function (analysisSysId, relatedSysId, primarySysId, jobSysId) {
    var findingGr = new GlideRecordSecure('x_snc_kb_refinery_finding');
    findingGr.initialize();
    findingGr.setValue('parent', analysisSysId);
    findingGr.setValue('type', 'duplicate');
    findingGr.setValue('severity', 'medium');
    findingGr.setValue('detail', 'Substantial content overlap detected with another article in the same knowledge base.');
    findingGr.setValue('related_article', relatedSysId);
    findingGr.setValue('recommended_primary', primarySysId);
    findingGr.setValue('last_job', jobSysId);
    findingGr.insert();
};

RefineryOrchestrator._handleEnrichingResult = function (userData, result) {
    gs.info('[Refinery][Enrich] analysis=' + userData.analysisSysId + ' raw LLM response: '
        + JSON.stringify(result).substring(0, 4000));

    var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    if (!analysisGr.get(userData.analysisSysId)) {
        gs.error('[Refinery][Enrich] analysis=' + userData.analysisSysId + ' Analysis record no longer exists -- aborting.');
        RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'failed');
        return;
    }

    var incidentAnalysis = result.incident_analysis || [];
    var incidentIndex = userData.incidentIndex || {};
    gs.info('[Refinery][Enrich] analysis=' + userData.analysisSysId + ' incident_analysis entries: '
        + incidentAnalysis.length + ' (candidates sent: ' + (userData.incidentCount || 0)
        + ', incidentIndex keys: ' + JSON.stringify(Object.keys(incidentIndex)) + ')');

    var relevantCount = 0;
    var evidenceCreated = 0;
    for (var i = 0; i < incidentAnalysis.length; i++) {
        var entry = incidentAnalysis[i];
        var incidentSysId = incidentIndex[entry.incident_id];
        gs.info('[Refinery][Enrich] analysis=' + userData.analysisSysId + ' incident_id=' + entry.incident_id
            + ' relevant=' + entry.relevant + ' resolvedSysId=' + incidentSysId
            + ' contradicts_article=' + entry.contradicts_article
            + ' new_information="' + String(entry.new_information || '').substring(0, 200) + '"');

        if (!entry.relevant) continue;
        relevantCount++;
        if (!incidentSysId) {
            gs.info('[Refinery][Enrich] analysis=' + userData.analysisSysId + ' incident_id=' + entry.incident_id
                + ' marked relevant but did not resolve to a known incident sys_id -- no Evidence row created.');
            continue;
        }
        if (!userData.gapFindingSysId) {
            gs.info('[Refinery][Enrich] analysis=' + userData.analysisSysId
                + ' incident marked relevant but no gapFindingSysId to attach Evidence to -- skipped.');
            continue;
        }

        var evidenceGr = new GlideRecordSecure('x_snc_kb_refinery_evidence');
        evidenceGr.initialize();
        evidenceGr.setValue('finding', userData.gapFindingSysId);
        evidenceGr.setValue('incident', incidentSysId);
        evidenceGr.setValue('new_information', entry.new_information || '');
        evidenceGr.setValue('contradicts_article', !!entry.contradicts_article);
        evidenceGr.insert();
        evidenceCreated++;
    }
    gs.info('[Refinery][Enrich] analysis=' + userData.analysisSysId + ' relevant incidents: ' + relevantCount
        + ' / ' + incidentAnalysis.length + ', Evidence rows created: ' + evidenceCreated);

    analysisGr.setValue('enrichment_confidence', result.confidence || '');

    var extractable = !!(result.ai_ready_knowledge && result.ai_ready_knowledge.extractable);
    gs.info('[Refinery][Enrich] analysis=' + userData.analysisSysId + ' confidence=' + result.confidence
        + ' ai_ready_knowledge.extractable=' + extractable
        + ' ai_ready_knowledge=' + JSON.stringify(result.ai_ready_knowledge || {}).substring(0, 2000));

    if (extractable) {
        // `contradictions` is carried through to Call 3, which preserves the
        // original article by default -- anything not flagged here survives
        // into the rewrite unchanged, however stale.
        analysisGr.setValue('enrichment_knowledge', JSON.stringify({
            ai_ready_knowledge: result.ai_ready_knowledge,
            contradictions: result.contradictions || [],
            recommendations: result.recommendations || []
        }));
        analysisGr.update();
        gs.info('[Refinery][Enrich] analysis=' + userData.analysisSysId + ' enrichment_knowledge saved -- article proceeds to scoring.');

        RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'scoring');
        var rewriteItem = RefineryOrchestrator._buildRescoringItem(userData.jobSysId, userData.batchNumber, {
            jobItemSysId: userData.jobItemSysId, analysisSysId: userData.analysisSysId
        });
        if (rewriteItem) {
            RefineryOrchestrator._queueForDispatch(userData.jobSysId, userData.batchNumber, 'scoring', rewriteItem);
        } else {
            RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'failed');
        }
    } else {
        // Genuinely couldn't extract anything usable, even drawing on general
        // knowledge (see the 2026-09-03 prompt rewrite) -- this article has
        // no further route forward this run.
        analysisGr.setValue('pipeline_stage', 'failed');
        analysisGr.update();
        // No enriched Snapshot content to produce -- write an empty one purely
        // to carry this outcome message (not always an error, see tables.md).
        // Leaving Analysis.enrichment_knowledge unset here is what keeps this
        // article out of the scoring step's rewrite dispatch.
        RefineryOrchestrator._writeSnapshot(userData.analysisSysId, 'enriched', '', null, null, 0, userData.jobSysId,
            RefineryOrchestrator._currentSnapshotVersion(userData.analysisSysId));

        var skipMessage = 'enrichment skipped: could not extract AI-ready knowledge from the article, incident data, or general practice';
        RefineryOrchestrator._recordProcessingMessage(userData.analysisSysId, 'enriched', skipMessage);
        gs.info('[Refinery][Enrich] analysis=' + userData.analysisSysId + ' ' + skipMessage);

        RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'completed');
    }
};

/**
 * Turns Call 3's resolved_finding_ids/unresolved_gaps labels (see
 * _indexedFindingsToText) back into writes on the real Finding records this
 * job's Quality Findings list was built from, and records a human-readable
 * "what's still open" message on the enriched Snapshot.
 *
 * A finding the model never mentions either way (not in resolved_finding_ids,
 * not in unresolved_gaps) is left untouched -- there's no basis to assume it
 * was silently fixed just because the model didn't call it out as unresolved.
 *
 * @param {string} analysisSysId
 * @param {Object} findingIndex - label ('F1', 'F2', ...) -> Finding.sys_id,
 *   from the same _buildRescoringItem call this result answers.
 * @param {Object} result - Call 3's parsed JSON response.
 */
RefineryOrchestrator._applyFindingResolutions = function (analysisSysId, findingIndex, result) {
    findingIndex = findingIndex || {};

    var resolvedLabels = result.resolved_finding_ids || [];
    for (var i = 0; i < resolvedLabels.length; i++) {
        RefineryOrchestrator._setFindingState(findingIndex[resolvedLabels[i]], 'remediated');
    }

    // Call 3 is told to leave a gap it can't close from its sources rather
    // than fabricating a step, and to name which finding and why. Surfacing
    // that on the snapshot is the only way anyone finds out which repairs
    // the rewrite deliberately declined -- the alternative is a silently
    // incomplete article that scored well.
    var unresolved = result.unresolved_gaps || [];
    var reasons = [];
    for (var j = 0; j < unresolved.length; j++) {
        var entry = unresolved[j];
        // Tolerate the older plain-string shape too (a stale prompt
        // template reply) -- treat it as a reason with no resolvable
        // finding_id rather than throwing on entry.reason.
        var reason = (entry && typeof entry === 'object') ? (entry.reason || '') : String(entry || '');
        if (reason) reasons.push(reason);

        var label = (entry && typeof entry === 'object') ? entry.finding_id : null;
        if (label) RefineryOrchestrator._setFindingState(findingIndex[label], 'acknowledged');
    }

    if (reasons.length) {
        RefineryOrchestrator._recordProcessingMessage(analysisSysId, 'enriched',
            'rewrite left ' + reasons.length + ' gap(s) unresolved: - ' + reasons.join(' - '));
    }
};

/** Fetches one Finding by sys_id and writes its state -- no-op if the id is falsy or the record is gone. */
RefineryOrchestrator._setFindingState = function (findingSysId, state) {
    if (!findingSysId) return;
    var findingGr = new GlideRecordSecure('x_snc_kb_refinery_finding');
    if (!findingGr.get(findingSysId)) return;
    findingGr.setValue('state', state);
    findingGr.update();
};

RefineryOrchestrator._handleRescoringResult = function (userData, result) {
    var enrichedContent = result.enriched_content || '';
    var scorer = new AIReadabilityScorer();
    var scored = scorer.score(enrichedContent, { detail: true });

    // llm_score is deliberately left unset here (null) -- Call 3
    // (article_synthesis) no longer self-scores its own rewrite. The final
    // scoring dispatch below picks this snapshot up next and scores it with
    // the literal same kb_article_analysis prompt used for raw/converted, so
    // all three are comparable. The Job Item stays 'scoring' throughout --
    // this article isn't done until the enriched score actually lands.
    RefineryOrchestrator._writeSnapshot(userData.analysisSysId, 'enriched', enrichedContent, scored, null, 0, userData.jobSysId,
        RefineryOrchestrator._currentSnapshotVersion(userData.analysisSysId));

    // Reflects the model's own resolved_finding_ids/unresolved_gaps labels
    // (see _indexedFindingsToText) back onto the real Finding records this
    // job's Quality Findings list was built from -- otherwise the report
    // page has no way to show which gaps this rewrite actually closed, and
    // every Finding sits at its 'new' default forever (see
    // kb-refinery-domain.md's Finding.state note).
    RefineryOrchestrator._applyFindingResolutions(userData.analysisSysId, userData.findingIndex, result);

    var scoreItem = RefineryOrchestrator._buildEnrichedScoringItem(userData.jobSysId, userData.batchNumber, {
        jobItemSysId: userData.jobItemSysId, analysisSysId: userData.analysisSysId
    });
    if (scoreItem) {
        RefineryOrchestrator._queueForDispatch(userData.jobSysId, userData.batchNumber, 'scoring', scoreItem);
    } else {
        RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'failed');
    }
};

/** Writes the quality_score from _buildEnrichedScoringItem's LLM call onto the enriched snapshot, and marks the article ready. */
RefineryOrchestrator._handleEnrichedScoringResult = function (userData, result) {
    var enrichedGr = RefineryOrchestrator._latestSnapshot(userData.analysisSysId, 'enriched');
    if (!enrichedGr) {
        gs.error('[Refinery] _handleEnrichedScoringResult: no enriched snapshot for analysis ' + userData.analysisSysId + '.');
        RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'failed');
        return;
    }
    enrichedGr.setValue('llm_score', RefineryOrchestrator._clampScore(result.quality_score || 0));
    enrichedGr.update();

    var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
    if (analysisGr.get(userData.analysisSysId)) {
        analysisGr.setValue('pipeline_stage', 'ready');
        analysisGr.update();
    }

    RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'completed');
};

/** Called by RefineryLLMCallback for processErrored/processCancelled, and for a dispatch-time failure. */
RefineryOrchestrator.handleBatchFailure = function (userData, message) {
    gs.warn('[Refinery] RefineryOrchestrator.handleBatchFailure: ' + JSON.stringify(userData) + ': ' + message);

    var snapshotType = (userData.phase === 'analyzing') ? 'converted'
        : (userData.phase === 'scoring_raw') ? 'raw'
            : (userData.phase === 'enriching' || userData.phase === 'rescoring' || userData.phase === 'scoring_enriched') ? 'enriched'
                : null;

    if (snapshotType && userData.analysisSysId) {
        RefineryOrchestrator._recordProcessingMessage(userData.analysisSysId, snapshotType, message.substring(0, 4000));
    }
    // deduplicating failures have no per-article snapshot to attach to -- logged only.

    // A failure in a substantive phase leaves this article with no other
    // route to 'ready' this run -- mark it rather than leaving pipeline_stage
    // stuck at 'analyzing' with no signal anything went wrong. Excludes
    // 'scoring_raw': that call is comparison-only and never gates readiness,
    // so its own failure shouldn't taint the article's overall outcome.
    if (userData.analysisSysId && userData.phase !== 'scoring_raw') {
        var analysisGr = new GlideRecordSecure('x_snc_kb_refinery_analysis');
        if (analysisGr.get(userData.analysisSysId)) {
            analysisGr.setValue('pipeline_stage', 'failed');
            analysisGr.update();
        }
    }

    // 'scoring_raw' and 'deduplicating' never gate a Job Item's own status --
    // scoring_raw is comparison-only, deduplicating carries analysisSysIdA/B
    // pairs rather than a single jobItemSysId in the first place.
    if (userData.jobItemSysId && userData.phase !== 'scoring_raw') {
        RefineryOrchestrator._markJobItemStatus(userData.jobItemSysId, 'failed');
    }
};

/**
 * Called once per (job, batch) represented in a single callback invocation.
 * Flushes whatever this callback queued for dispatch for that batch (via
 * _queueForDispatch), then checks whether that one batch is now finished.
 */
RefineryOrchestrator.onBatchItemsResolved = function (jobSysId, batchNumber) {
    var prefix = jobSysId + ':' + batchNumber + ':';
    var keys = Object.keys(RefineryOrchestrator._pendingDispatch);
    for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(prefix) !== 0) continue;
        var items = RefineryOrchestrator._pendingDispatch[keys[i]];
        delete RefineryOrchestrator._pendingDispatch[keys[i]];
        // _dispatchOrFail already isolates the dispatch-vs-failure-handling
        // split internally -- this outer catch is only for something
        // unexpected in the flush itself, so it can never leave
        // _checkBatchFinished below unreached.
        try {
            RefineryOrchestrator._dispatchOrFail(items);
        } catch (e) {
            for (var j = 0; j < items.length; j++) {
                RefineryOrchestrator._recoverFromUnhandledError(items[j].userData, e);
            }
        }
    }

    RefineryOrchestrator._checkBatchFinished(jobSysId, batchNumber);
};

/**
 * Checks whether every Job Item in one batch has reached a terminal status
 * (completed/failed/skipped). If so, decrements Job.remaining_batches --
 * scoped to one batch, not a whole-job aggregate, specifically to shrink
 * how often this runs (once per batch, not once per individual article
 * across every batch) and therefore how often two concurrent calls could
 * even race each other.
 */
RefineryOrchestrator._checkBatchFinished = function (jobSysId, batchNumber) {
    var totalGa = new GlideAggregate('x_snc_kb_refinery_job_item');
    totalGa.addQuery('job', jobSysId);
    totalGa.addQuery('batch_number', batchNumber);
    totalGa.addAggregate('COUNT');
    totalGa.query();
    var total = totalGa.next() ? (parseInt(totalGa.getAggregate('COUNT'), 10) || 0) : 0;
    if (total === 0) return;

    var resolvedGa = new GlideAggregate('x_snc_kb_refinery_job_item');
    resolvedGa.addQuery('job', jobSysId);
    resolvedGa.addQuery('batch_number', batchNumber);
    resolvedGa.addQuery('status', 'IN', 'completed,failed,skipped');
    resolvedGa.addAggregate('COUNT');
    resolvedGa.query();
    var resolved = resolvedGa.next() ? (parseInt(resolvedGa.getAggregate('COUNT'), 10) || 0) : 0;

    if (resolved < total) return; // this batch still has work in flight

    RefineryOrchestrator._decrementRemainingBatches(jobSysId);
};

/**
 * Decrements Job.remaining_batches by 1 -- called once a specific batch has
 * been confirmed fully resolved. When it reaches 0, every batch is done and
 * the job as a whole is finalized via _finalizeJob.
 *
 * Not protected by a true atomic decrement (GlideRecord doesn't expose one
 * to scoped-app scripts) -- if two batches' completions raced at the exact
 * same instant, both could read the same starting value and the counter
 * would only move down by 1 instead of 2. Accepted: this is now called at
 * most once per batch for the whole job (typically 1-2 times total), a much
 * smaller collision surface than re-deriving state on every individual
 * article's status change, and batches are already naturally staggered in
 * time since _startJob processes them one after another.
 */
RefineryOrchestrator._decrementRemainingBatches = function (jobSysId) {
    var jobGr = new GlideRecordSecure('x_snc_kb_refinery_job');
    if (!jobGr.get(jobSysId)) return;

    var remaining = parseInt(jobGr.getValue('remaining_batches'), 10) || 0;
    if (remaining <= 0) return; // already finalized -- nothing left to decrement

    remaining -= 1;
    jobGr.setValue('remaining_batches', remaining);
    jobGr.update();

    if (remaining === 0) {
        RefineryOrchestrator._finalizeJob(jobSysId);
    }
};

/**
 * Runs once per job, when remaining_batches reaches 0 (or immediately, for
 * a job with zero batches at all). Decides the job's final outcome from the
 * real Job Item status breakdown across the whole job: all completed
 * (skipped counts as a clean outcome, not an error) -> 'completed'; any
 * failed mixed with at least one completed or skipped ->
 * 'completed_with_errors'; every item failed -> 'failed'.
 */
RefineryOrchestrator._finalizeJob = function (jobSysId) {
    var jobGr = new GlideRecordSecure('x_snc_kb_refinery_job');
    if (!jobGr.get(jobSysId)) return;

    var ga = new GlideAggregate('x_snc_kb_refinery_job_item');
    ga.addQuery('job', jobSysId);
    ga.addQuery('status', 'IN', 'completed,failed,skipped');
    ga.groupBy('status');
    ga.addAggregate('COUNT');
    ga.query();

    var counts = { completed: 0, failed: 0, skipped: 0 };
    while (ga.next()) {
        counts[ga.getValue('status')] = parseInt(ga.getAggregate('COUNT'), 10) || 0;
    }

    var finalStatus;
    if (counts.failed === 0) {
        finalStatus = 'completed';
    } else if (counts.completed > 0 || counts.skipped > 0) {
        finalStatus = 'completed_with_errors';
    } else {
        finalStatus = 'failed';
    }

    jobGr.setValue('status', finalStatus);
    jobGr.setValue('completed_at', new GlideDateTime());
    jobGr.update();
};
