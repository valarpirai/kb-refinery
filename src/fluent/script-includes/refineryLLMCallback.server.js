var RefineryLLMCallback = Class.create();
RefineryLLMCallback.prototype = {
    initialize: function () {
    },

    /**
     * Fires when an async batch dispatched by RefineryLLM.dispatchBatch completes.
     * One callback for the whole batch, with N results keyed under `response.result`
     * -- each key carrying its own `.meta.user_data` (the correlation data
     * RefineryOrchestrator's _build*Item functions attached at dispatch time) and
     * `.result.response`/`.result.message` (the model's raw text reply). Confirmed
     * shape, not a guess -- matches both AI Group Chat's AIGCSkillCallback's existing
     * (always single-item) convention and a live batched client-side test.
     */
    processCompleted: function (response) {
        var items = this._extractResultItems(response);
        if (items.length === 0) {
            gs.warn('[Refinery] RefineryLLMCallback.processCompleted: no usable result items extracted from response: ' + JSON.stringify(response));
            return;
        }

        var batchKeys = {};
        for (var i = 0; i < items.length; i++) {
            var userData = items[i].userData;
            if (!userData || gs.nil(userData.jobSysId)) {
                gs.warn('[Refinery] RefineryLLMCallback.processCompleted: result item has no usable user_data.jobSysId - skipping');
                continue;
            }
            this._trackBatch(batchKeys, userData);

            // Every item is isolated in its own try/catch: one item's
            // handler throwing for a reason this app didn't anticipate must
            // not abort this loop and leave every *other* item in this same
            // callback (and this._resolveBatches below, which is what
            // actually advances the job) unreached.
            try {
                // RefineryLLM.parseJsonReply (via RefineryJsonUtil.safeJSONParse) never
                // throws -- on a bad reply it just returns the original raw string, so
                // a parse failure is detected by type rather than by catching an
                // exception. Every prompt template's schema always replies with a JSON
                // object, so anything else here is a real parse failure.
                var parsed = RefineryLLM.parseJsonReply(items[i].rawText);
                if (!parsed || typeof parsed !== 'object') {
                    gs.warn('[Refinery] RefineryLLMCallback.processCompleted: could not parse JSON reply for ' + JSON.stringify(userData) + ': ' + items[i].rawText);
                    RefineryOrchestrator.handleBatchFailure(userData, 'could not parse LLM reply (non-JSON response)');
                    continue;
                }
                RefineryOrchestrator.handleBatchResult(userData, parsed);
            } catch (e) {
                RefineryOrchestrator._recoverFromUnhandledError(userData, e);
            }
        }

        this._resolveBatches(batchKeys);
    },

    processErrored: function (response) {
        this._handleFailure(response, 'errored');
    },

    processCancelled: function (response) {
        this._handleFailure(response, 'cancelled');
    },

    _handleFailure: function (response, statusLabel) {
        var items = this._extractResultItems(response);
        if (items.length === 0) {
            gs.warn('[Refinery] RefineryLLMCallback: ' + statusLabel + ' callback with no usable user_data - cannot resolve which batch this was: ' + JSON.stringify(response));
            return;
        }

        var batchKeys = {};
        for (var i = 0; i < items.length; i++) {
            var userData = items[i].userData;
            if (!userData || gs.nil(userData.jobSysId)) continue;
            this._trackBatch(batchKeys, userData);
            // Isolated per item -- see the matching comment in processCompleted.
            try {
                RefineryOrchestrator.handleBatchFailure(userData, 'LLM call ' + statusLabel);
            } catch (e) {
                RefineryOrchestrator._recoverFromUnhandledError(userData, e);
            }
        }

        this._resolveBatches(batchKeys);
    },

    /**
     * Records one (jobSysId, batchNumber) pair to resolve once this
     * callback's whole loop finishes. Items with no batchNumber (the
     * deduplicating phase's pairwise userData) never gate a Job Item's own
     * status, so there's nothing to resolve for them -- skipped here rather
     * than tracked.
     */
    _trackBatch: function (batchKeys, userData) {
        if (gs.nil(userData.batchNumber)) return;
        var key = userData.jobSysId + ':' + userData.batchNumber;
        batchKeys[key] = { jobSysId: userData.jobSysId, batchNumber: userData.batchNumber };
    },

    /** Called once per distinct (job, batch) pair represented in this callback invocation. */
    _resolveBatches: function (batchKeys) {
        var keys = Object.keys(batchKeys);
        for (var i = 0; i < keys.length; i++) {
            RefineryOrchestrator.onBatchItemsResolved(batchKeys[keys[i]].jobSysId, batchKeys[keys[i]].batchNumber);
        }
    },

    /**
     * @returns {Array<{userData: Object, rawText: string}>}
     */
    _extractResultItems: function (response) {
        if (!response || !response.result) {
            return [];
        }

        var keys = Object.keys(response.result);
        var items = [];

        for (var i = 0; i < keys.length; i++) {
            var resultObj = response.result[keys[i]];
            if (!resultObj) continue;

            var userData = resultObj.meta && resultObj.meta.user_data;
            var text = resultObj.result && (resultObj.result.response || resultObj.result.message);
            if (!userData || gs.nil(text)) continue;

            items.push({ userData: userData, rawText: String(text) });
        }

        return items;
    },

    type: 'RefineryLLMCallback'
};
