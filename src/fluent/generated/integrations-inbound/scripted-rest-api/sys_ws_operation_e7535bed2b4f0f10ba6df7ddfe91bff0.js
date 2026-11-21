(function process(request, response) {

    var MAX_BATCH = 100;
    var SCORER_VERSION = 'v5-heuristic-5';

    var body;
    try {
        body = request.body.data;
    } catch (e) {
        return send(400, { error: 'Body is not valid JSON. Set Content-Type: application/json.' });
    }
    if (!body || typeof body !== 'object')
        return send(400, { error: 'Empty request body.' });

    var opts = body.options || {};
    if (opts.resolve_links === undefined) opts.resolve_links = true;

    // --- construct the scorer BEFORE any branch that uses it
    var scorer;
    try {
        scorer = new AIReadabilityScorer(opts);
    } catch (e2) {
        gs.error('[AIReadability] Scorer init failed: ' + e2);
        return send(500, { error: 'Scorer unavailable. Check the AIReadabilityScorer Script Include.' });
    }

    // --- { number } or { sys_id }: the Script Include loads the article
    if (typeof body.number === 'string' || typeof body.sys_id === 'string') {
        var byRef = scorer.scoreArticle(body.number || body.sys_id, opts);
        return send(byRef.ok ? 200 : 422, byRef);
    }

    // --- { text } or { articles: [ { ref, text } ] }
    var single = (typeof body.text === 'string');
    var items;

    if (single) {
        items = [{ ref: body.ref || 'article-1', text: body.text }];
    } else if (body.articles && body.articles.length) {
        items = body.articles;
    } else {
        return send(400, {
            error: 'Provide number, sys_id, text, or an articles[] array of { ref, text }.'
        });
    }

    if (items.length > MAX_BATCH)
        return send(400, { error: 'Batch limit is ' + MAX_BATCH + '.' });

    var results = [], sum = 0, scored = 0;

    for (var i = 0; i < items.length; i++) {
        var it = items[i] || {};
        var ref = it.ref || ('article-' + (i + 1));

        if (typeof it.text !== 'string' || !it.text.length) {
            results.push({
                ref: ref, ok: false,
                error: { code: 'MISSING_TEXT', message: 'Missing or empty text.' },
                score: null, breakdown: null
            });
            continue;
        }

        try {
            var r = scorer.score(it.text, opts);
            r.ref = ref;
            results.push(r);
            if (r.ok) { sum += r.score; scored++; }
        } catch (e3) {
            gs.error('[AIReadability] Failed on ' + ref + ': ' + e3);
            results.push({
                ref: ref, ok: false,
                error: { code: 'SCORING_EXCEPTION', message: String(e3) },
                score: null, breakdown: null
            });
        }
    }

    if (single) {
        var only = results[0];
        return send(only.ok ? 200 : 422, only);
    }

    return send(200, {
        scorer_version: SCORER_VERSION,
        link_resolution: opts.resolve_links ? 'enabled' : 'disabled',
        count: items.length,
        scored: scored,
        failed: items.length - scored,
        average_score: scored ? Math.round((sum / scored) * 10) / 10 : null,
        results: results
    });

    function send(status, payload) {
        response.setStatus(status);
        response.setContentType('application/json');
        response.getStreamWriter().writeString(JSON.stringify(payload));
    }

})(request, response);