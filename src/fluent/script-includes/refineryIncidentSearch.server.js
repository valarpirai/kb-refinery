var RefineryIncidentSearch = Class.create();
RefineryIncidentSearch.prototype = {
    initialize: function () {
    },

    type: 'RefineryIncidentSearch'
};

RefineryIncidentSearch.MAX_CANDIDATES = 50;

// TODO: verify against the target instance -- these are the common
// out-of-box incident.state values for Resolved/Closed, but state choices
// are commonly customized per instance. Re-check before trusting this filter
// (see docs/plan.md's Incident Lookup Strategy / this plan's Phase D note).
RefineryIncidentSearch.RESOLVED_CLOSED_STATES = ['6', '7'];

/**
 * Layer 1 (structured pre-filter) + Layer 2 (keyword overlap) of the incident
 * lookup strategy in docs/plan.md. Does NOT call the LLM -- that's Layer 3,
 * done separately by the caller via RefineryLLM.call('incident_enrichment', ...).
 *
 * Layer 2 runs as its own query (not a script-side filter over Layer 1's
 * results) so the keyword match runs against the full structurally-filtered
 * set, not just whatever Layer 1's own limit happened to return first. Layer
 * 2 matches are prioritized; remaining slots are filled from Layer 1 by
 * recency.
 *
 * @param {string} category - kb_knowledge.category of the article being enriched.
 * @param {string[]} searchTerms - Analysis.search_terms (from Call 1).
 * @returns {Array<Object>} up to MAX_CANDIDATES {sys_id, number, short_description, close_notes}.
 */
RefineryIncidentSearch.findCandidates = function (category, searchTerms) {
    gs.info('[Refinery][IncidentSearch] called with category="' + category + '" (nil=' + gs.nil(category)
        + ' -- filter is ' + (gs.nil(category) ? 'SKIPPED, no category restriction' : 'APPLIED') + '), searchTerms='
        + JSON.stringify(searchTerms) + ', RESOLVED_CLOSED_STATES=' + RefineryIncidentSearch.RESOLVED_CLOSED_STATES.join(','));

    var oneYearAgo = new GlideDateTime();
    oneYearAgo.addSeconds(-365 * 24 * 60 * 60);

    var baseQuery = function () {
        var gr = new GlideRecordSecure('incident');
        if (!gs.nil(category)) {
            gr.addQuery('category', category);
        }
        gr.addQuery('state', 'IN', RefineryIncidentSearch.RESOLVED_CLOSED_STATES.join(','));
        gr.addQuery('resolved_at', '>=', oneYearAgo);
        gr.addNotNullQuery('close_notes');
        return gr;
    };

    var toCandidate = function (gr) {
        return {
            sys_id: gr.getUniqueValue(),
            number: gr.getValue('number'),
            short_description: gr.getValue('short_description'),
            close_notes: gr.getValue('close_notes')
        };
    };

    var results = [];
    var seen = {};

    if (searchTerms && searchTerms.length > 0) {
        var gr2 = baseQuery();
        var qc = gr2.addQuery('short_description', 'LIKE', searchTerms[0]);
        qc.addOrCondition('close_notes', 'LIKE', searchTerms[0]);
        for (var i = 1; i < searchTerms.length; i++) {
            qc.addOrCondition('short_description', 'LIKE', searchTerms[i]);
            qc.addOrCondition('close_notes', 'LIKE', searchTerms[i]);
        }
        gr2.orderByDesc('resolved_at');
        gr2.setLimit(RefineryIncidentSearch.MAX_CANDIDATES);
        gs.info('[Refinery][IncidentSearch] Layer 2 (keyword) encoded query: ' + gr2.getEncodedQuery());
        gr2.query();
        while (gr2.next()) {
            var candidate = toCandidate(gr2);
            seen[candidate.sys_id] = true;
            results.push(candidate);
        }
        gs.info('[Refinery][IncidentSearch] Layer 2 (keyword match on search_terms) found: ' + results.length);
    } else {
        gs.info('[Refinery][IncidentSearch] no searchTerms provided -- Layer 2 (keyword match) skipped entirely.');
    }

    if (results.length < RefineryIncidentSearch.MAX_CANDIDATES) {
        var gr1 = baseQuery();
        gr1.orderByDesc('resolved_at');
        gr1.setLimit(RefineryIncidentSearch.MAX_CANDIDATES);
        gs.info('[Refinery][IncidentSearch] Layer 1 (structured, recency fill) encoded query: ' + gr1.getEncodedQuery());
        var beforeLayer1 = results.length;
        gr1.query();
        while (gr1.next() && results.length < RefineryIncidentSearch.MAX_CANDIDATES) {
            var sysId = gr1.getUniqueValue();
            if (seen[sysId]) continue;
            seen[sysId] = true;
            results.push(toCandidate(gr1));
        }
        gs.info('[Refinery][IncidentSearch] Layer 1 added ' + (results.length - beforeLayer1) + ' more candidate(s) by recency.');
    }

    gs.info('[Refinery][IncidentSearch] returning ' + results.length + ' total candidate(s).');
    return results;
};
