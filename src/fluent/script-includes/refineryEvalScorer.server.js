/**
 * Ad hoc eval tool: for every x_snc_kb_refinery_eval_question row, tokenizes
 * its `query` and its referenced KB article(s)' real content, then scores
 * how much of the query's vocabulary each referenced KB actually contains --
 * a cheap proxy for "does the current content of this KB still cover this
 * query." Not called by any pipeline code; run it yourself from Scripts -
 * Background:
 *
 *   var result = RefineryEvalScorer.run();
 *
 * Tokenizing/scoring is the same plain token-overlap approach
 * SkillDiscoveryService (Agent Skill Kit) uses for its own search() --
 * lowercase, split on non-alphanumerics, dedupe, then count how many query
 * tokens appear in the doc. Normalized here to a 0-100 coverage percentage
 * (matches / query token count) so questions of very different lengths are
 * comparable.
 *
 * Two scores are computed per KB, from the exact same extracted content:
 *   - scoreRaw: tokenized straight off the field value(s), HTML tags and all.
 *   - scoreStripped: tokenized after stripping HTML tags (via stripHtmlTags,
 *     adapted from sn_km_gen_ai.KMWWNAUtilsSNC).
 * Comparing the two shows how much raw markup noise (tag names, attributes,
 * class names, etc.) is inflating or diluting the plain-token-overlap score.
 *
 * Content extraction (the class-dispatch: plain kb_knowledge `text` field
 * vs. a kb_template_* subclass's own rich-text fields vs. the FAQ
 * template's question/answer pairs) lives in RefineryKbContent.getText --
 * shared with every other caller that needs a KB article's real body
 * text, not re-implemented here.
 */
var RefineryEvalScorer = Class.create();
RefineryEvalScorer.prototype = {
    initialize: function () {
    },
    type: 'RefineryEvalScorer'
};

RefineryEvalScorer.DEFAULT_WORST_COUNT = 20;

/**
 * @param {Object} [options]
 * @param {number} [options.limit] Cap on eval_question rows processed (omit/0 = all).
 * @param {string} [options.sysId] Score just this one eval_question record.
 * @param {number} [options.worstCount] How many lowest-scoring questions/KBs to include (default 20).
 * @param {boolean} [options.printSummary] Print a summary via gs.print (default true).
 * @returns {{questions: Array<Object>, summary: Object}}
 */
RefineryEvalScorer.run = function (options) {
    options = options || {};
    var worstCount = options.worstCount || RefineryEvalScorer.DEFAULT_WORST_COUNT;
    var printSummary = options.printSummary !== false;

    // KBs are commonly cited by more than one question -- extract/strip once
    // per KB, not once per question that happens to cite it.
    var kbCache = {};

    var questions = [];
    var gr = new GlideRecordSecure('x_snc_kb_refinery_eval_question');
    if (options.sysId) {
        gr.addQuery('sys_id', options.sysId);
    } else if (options.limit) {
        gr.setLimit(options.limit);
    }
    gr.query();
    while (gr.next()) {
        var scored = RefineryEvalScorer._scoreQuestion(gr, kbCache);
        questions.push(scored);
        RefineryEvalScorer._writeScores(gr, scored);
    }

    var summary = RefineryEvalScorer._summarize(questions, worstCount);
    if (printSummary) {
        RefineryEvalScorer._printSummary(summary, worstCount);
    }

    return { questions: questions, summary: summary };
};

RefineryEvalScorer._scoreQuestion = function (eqGr, kbCache) {
    var query = eqGr.getValue('query') || '';
    var queryTokens = RefineryEvalScorer._tokenize(query);

    var kbSysIds = (eqGr.getValue('kb_article') || '')
        .split(',')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);

    var kbResults = [];
    for (var i = 0; i < kbSysIds.length; i++) {
        kbResults.push(RefineryEvalScorer._scoreKb(kbSysIds[i], queryTokens, kbCache));
    }

    var strippedScores = [];
    var rawScores = [];
    for (var j = 0; j < kbResults.length; j++) {
        if (kbResults[j].status === 'ok' && kbResults[j].scoreStripped !== null) {
            strippedScores.push(kbResults[j].scoreStripped);
            rawScores.push(kbResults[j].scoreRaw);
        }
    }

    return {
        sysId: eqGr.getUniqueValue(),
        query: query,
        queryTokenCount: queryTokens.length,
        kbResults: kbResults,
        bestScoreStripped: strippedScores.length ? Math.max.apply(null, strippedScores) : null,
        bestScoreRaw: rawScores.length ? Math.max.apply(null, rawScores) : null,
        avgScoreStripped: strippedScores.length ? RefineryEvalScorer._avg(strippedScores) : null,
        avgScoreRaw: rawScores.length ? RefineryEvalScorer._avg(rawScores) : null,
        unscored: strippedScores.length === 0
    };
};

/**
 * Persists the two integer score columns (score_raw/score_stripped) on the
 * eval_question record itself -- rounded to the nearest whole percent (the
 * columns are IntegerColumn, not float) and clamped to 0-100 here, in
 * script, before the write. The dictionary has no min/max constraint on
 * these columns -- that's a schema-level attribute, not a real enforced
 * bound, so this is the actual (and only) place the range is enforced.
 * Cleared (blank) when unscored, so a stale score from a prior run doesn't
 * linger once a question no longer resolves to any scorable KB.
 */
RefineryEvalScorer._writeScores = function (eqGr, scored) {
    eqGr.setValue('score_raw', RefineryEvalScorer._clampScore(scored.bestScoreRaw));
    eqGr.setValue('score_stripped', RefineryEvalScorer._clampScore(scored.bestScoreStripped));
    eqGr.update();
};

/**
 * Rounds to the nearest whole percent and clamps to [0, 100]. Coverage
 * scores are already computed as matches/queryTokens.length*100 so they
 * can't mathematically exceed this range -- clamped anyway since this is
 * the actual write site and nothing upstream is a trustworthy guarantee.
 * @returns {string|number} '' for null (clears the field), else an integer 0-100.
 */
RefineryEvalScorer._clampScore = function (score) {
    if (score === null || score === undefined || isNaN(score)) {
        return '';
    }
    return Math.min(100, Math.max(0, Math.round(score)));
};

RefineryEvalScorer._scoreKb = function (kbSysId, queryTokens, kbCache) {
    var cached = kbCache[kbSysId];
    if (!cached) {
        cached = RefineryEvalScorer._extractKb(kbSysId);
        kbCache[kbSysId] = cached;
    }

    var result = {
        kbSysId: kbSysId,
        number: cached.number,
        shortDescription: cached.shortDescription,
        kbClass: cached.kbClass,
        status: cached.status,
        scoreStripped: null,
        scoreRaw: null
    };

    if (cached.status !== 'ok' || queryTokens.length === 0) {
        return result;
    }

    result.scoreStripped = RefineryEvalScorer._coverage(queryTokens, RefineryEvalScorer._tokenize(cached.strippedText));
    result.scoreRaw = RefineryEvalScorer._coverage(queryTokens, RefineryEvalScorer._tokenize(cached.rawText));
    return result;
};

/**
 * Resolves one kb_knowledge sys_id to its real content, raw and with HTML
 * stripped.
 * @param {string} kbSysId
 * @returns {{status: string, kbClass: string, number: string, shortDescription: string, rawText: string, strippedText: string}}
 */
RefineryEvalScorer._extractKb = function (kbSysId) {
    var kbGr = new GlideRecordSecure('kb_knowledge');
    if (!kbGr.get(kbSysId)) {
        return { status: 'not_found', kbClass: '', number: '', shortDescription: '', rawText: '', strippedText: '' };
    }

    var kbClass = kbGr.getValue('sys_class_name') || 'kb_knowledge';
    var number = kbGr.getValue('number') || '';
    var shortDescription = kbGr.getValue('short_description') || '';
    var rawText = RefineryKbContent.getText(kbClass, kbSysId, kbGr);

    if (gs.nil(rawText)) {
        return { status: 'empty_text', kbClass: kbClass, number: number, shortDescription: shortDescription, rawText: '', strippedText: '' };
    }

    return {
        status: 'ok',
        kbClass: kbClass,
        number: number,
        shortDescription: shortDescription,
        rawText: rawText,
        strippedText: RefineryEvalScorer.stripHtmlTags(rawText)
    };
};

/**
 * Adapted from sn_km_gen_ai.KMWWNAUtilsSNC's stripHtmlTags -- only the
 * no-allowedTags path, since this tool always wants every tag gone for
 * token-matching purposes.
 * @param {string} html
 * @returns {string}
 */
RefineryEvalScorer.stripHtmlTags = function (html) {
    if (gs.nil(html)) {
        return '';
    }
    try {
        var allTagsAndStyle = /<style[^>]*>[\s\S]*?<\/style>|<\/?[^>]+>/gi;
        var nonBreakingSpaceRegex = /&nbsp;/g;
        return ('' + html).replace(allTagsAndStyle, '').replace(nonBreakingSpaceRegex, ' ');
    } catch (e) {
        gs.info('[RefineryEvalScorer] stripHtmlTags error: ' + e.toString());
        return '' + html;
    }
};

// Same tokenizer as SkillDiscoveryService._tokenize (Agent Skill Kit):
// lowercase, split on runs of non a-z0-9, dedupe.
RefineryEvalScorer._tokenize = function (text) {
    var lower = ('' + (text || '')).toLowerCase();
    var rawTokens = lower.split(/[^a-z0-9]+/);
    var seen = {};
    var tokens = [];
    for (var i = 0; i < rawTokens.length; i++) {
        if (rawTokens[i] && !seen[rawTokens[i]]) {
            seen[rawTokens[i]] = true;
            tokens.push(rawTokens[i]);
        }
    }
    return tokens;
};

/**
 * % of queryTokens present in docTokens (0-100, one decimal) -- same
 * token-overlap match as SkillDiscoveryService._score(), normalized by
 * query length so scores are comparable across questions of very
 * different lengths.
 * @returns {?number} null when queryTokens is empty (nothing to score).
 */
RefineryEvalScorer._coverage = function (queryTokens, docTokens) {
    if (queryTokens.length === 0) {
        return null;
    }
    var docSet = {};
    for (var i = 0; i < docTokens.length; i++) {
        docSet[docTokens[i]] = true;
    }
    var matches = 0;
    for (var j = 0; j < queryTokens.length; j++) {
        if (docSet[queryTokens[j]]) {
            matches++;
        }
    }
    return Math.round((matches / queryTokens.length) * 1000) / 10;
};

RefineryEvalScorer._avg = function (nums) {
    var sum = 0;
    for (var i = 0; i < nums.length; i++) {
        sum += nums[i];
    }
    return Math.round((sum / nums.length) * 10) / 10;
};

RefineryEvalScorer._bucketFor = function (score) {
    if (score === null) {
        return null;
    }
    if (score <= 0) return '0%';
    if (score <= 25) return '1-25%';
    if (score <= 50) return '26-50%';
    if (score <= 75) return '51-75%';
    return '76-100%';
};

RefineryEvalScorer._summarize = function (questions, worstCount) {
    var scored = questions.filter(function (q) { return !q.unscored; });
    var unscored = questions.filter(function (q) { return q.unscored; });

    var distributionStripped = {};
    var distributionRaw = {};
    var strippedScores = [];
    var rawScores = [];
    for (var i = 0; i < scored.length; i++) {
        var q = scored[i];
        strippedScores.push(q.bestScoreStripped);
        rawScores.push(q.bestScoreRaw);
        var bucketStripped = RefineryEvalScorer._bucketFor(q.bestScoreStripped);
        var bucketRaw = RefineryEvalScorer._bucketFor(q.bestScoreRaw);
        if (bucketStripped) {
            distributionStripped[bucketStripped] = (distributionStripped[bucketStripped] || 0) + 1;
        }
        if (bucketRaw) {
            distributionRaw[bucketRaw] = (distributionRaw[bucketRaw] || 0) + 1;
        }
    }

    var worstQuestions = scored
        .slice()
        .sort(function (a, b) { return a.bestScoreStripped - b.bestScoreStripped; })
        .slice(0, worstCount)
        .map(function (q) {
            return {
                sysId: q.sysId,
                query: q.query.length > 200 ? q.query.slice(0, 200) + '...' : q.query,
                bestScoreStripped: q.bestScoreStripped,
                bestScoreRaw: q.bestScoreRaw
            };
        });

    // Per-KB view: a KB cited by multiple questions gets its worst (minimum)
    // score across all of them -- one weak match is enough to flag it.
    var kbMin = {};
    for (var j = 0; j < scored.length; j++) {
        var kbResults = scored[j].kbResults;
        for (var k = 0; k < kbResults.length; k++) {
            var kr = kbResults[k];
            if (kr.status !== 'ok' || kr.scoreStripped === null) {
                continue;
            }
            var entry = kbMin[kr.kbSysId];
            if (!entry) {
                kbMin[kr.kbSysId] = {
                    kbSysId: kr.kbSysId,
                    number: kr.number,
                    shortDescription: kr.shortDescription,
                    minStripped: kr.scoreStripped,
                    minRaw: kr.scoreRaw
                };
            } else {
                entry.minStripped = Math.min(entry.minStripped, kr.scoreStripped);
                entry.minRaw = Math.min(entry.minRaw, kr.scoreRaw);
            }
        }
    }
    var worstKbs = Object.keys(kbMin)
        .map(function (id) { return kbMin[id]; })
        .sort(function (a, b) { return a.minStripped - b.minStripped; })
        .slice(0, worstCount);

    return {
        totalQuestions: questions.length,
        scorableQuestions: scored.length,
        unscorableQuestions: unscored.length,
        avgBestScoreStripped: strippedScores.length ? RefineryEvalScorer._avg(strippedScores) : null,
        avgBestScoreRaw: rawScores.length ? RefineryEvalScorer._avg(rawScores) : null,
        distributionStripped: distributionStripped,
        distributionRaw: distributionRaw,
        worstQuestions: worstQuestions,
        worstKbs: worstKbs
    };
};

RefineryEvalScorer._printSummary = function (summary, worstCount) {
    gs.print('=== RefineryEvalScorer ===');
    gs.print('Total eval questions: ' + summary.totalQuestions);
    gs.print('Scorable (>=1 referenced KB with real text): ' + summary.scorableQuestions);
    gs.print('Unscorable (no KB referenced, or none resolvable to text): ' + summary.unscorableQuestions);
    gs.print('Avg best-KB coverage -- stripped HTML: ' + summary.avgBestScoreStripped + '%, raw HTML: ' + summary.avgBestScoreRaw + '%');
    gs.print('Distribution (stripped): ' + JSON.stringify(summary.distributionStripped));
    gs.print('Distribution (raw): ' + JSON.stringify(summary.distributionRaw));
    gs.print('--- Worst ' + worstCount + ' questions (by stripped-HTML best-KB score) ---');
    for (var i = 0; i < summary.worstQuestions.length; i++) {
        var q = summary.worstQuestions[i];
        gs.print((i + 1) + '. [' + q.bestScoreStripped + '% stripped / ' + q.bestScoreRaw + '% raw] ' + q.sysId + ' -- ' + q.query);
    }
    gs.print('--- Worst ' + worstCount + ' KB articles (min coverage across all questions citing them) ---');
    for (var j = 0; j < summary.worstKbs.length; j++) {
        var kb = summary.worstKbs[j];
        gs.print((j + 1) + '. [' + kb.minStripped + '% stripped / ' + kb.minRaw + '% raw] ' + kb.number + ' -- ' + kb.shortDescription);
    }
};
