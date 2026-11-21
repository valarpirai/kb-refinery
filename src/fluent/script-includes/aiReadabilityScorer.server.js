var AIReadabilityScorer = Class.create();

AIReadabilityScorer.prototype = {

    /* =====================================================================
     * Scores content for AI / RAG readability out of 100.
     *
     *   score(text [, options])        -> envelope
     *   scoreArticle(ref [, options])  -> loads kb_knowledge, then score()
     *
     * Every return is an envelope. Check `ok` before reading `score`:
     *   { ok:true,  error:null, warnings:[], score, breakdown }
     *   { ok:false, error:{ code, message }, score:null, breakdown:null }
     *
     * Pass { detail: true } for findings + stats.
     * ===================================================================== */

    initialize: function (options) {
        this.cfg = this._merge(this._defaults(), options || {});
        this._kbCache = {};
    },

    _defaults: function () {
        return {
            // --- output
            detail: false,              // true -> include findings + stats

            // --- input gate
            minWords: 25,               // below this, refuse to score

            // --- C1 self-containedness
            hitRateCeiling: 8,          // hits per 1,000 words that scores zero
            minWordsForRate: 250,       // rate denominator floor (short-doc stability)

            // --- C2 chunk geometry
            maxSectionTokens: 512,
            tokensPerWord: 1.3,

            // --- C3 cleanliness
            markupOverheadFloor: 0.50,   // <= this fraction markup: full credit
            markupOverheadCeiling: 0.90, // >= this: no credit
            junkCeiling: 25,             // junk hits per 1,000 words that scores zero

            // --- C4 completeness
            minAltWords: 5,
            minRestatementWords: 20,
            restatementWindowWords: 60, // measured in TEXT words, not HTML chars
            decorativeMaxPx: 32,
            requireTableHeaders: true,

            // --- C5 reference integrity
            resolve_links: true,

            // --- scoreArticle
            includeTitleHeading: true,  // prepend short_description as an <h1>

            knownAcronyms: ['AI','API','URL','ID','OK','FAQ','PDF','HTML','CSV','JSON',
                            'HTTP','HTTPS','IT','PC','USB','FYI','CEO','CTO','US','UK',
                            'EU','AM','PM','UTC','GMT','SSO','VPN','CPU','RAM','OS',
                            'KB','CMDB','ITSM','ITIL','SLA','CI','RITM','CHG','INC',
                            'SN','MID','ACL','UI','MFA','LDAP','SAML','REST'],

            // all-caps English words that are not acronyms
            capsStopWords: ['NOTE','NOTES','DO','NOT','AND','OR','THE','ALL','NEW','OLD',
                            'YES','NO','TIP','STEP','END','SEE','ADD','SET','GET','RUN',
                            'TODO','FIXME','WARN','IMPORTANT','ONLY','THEN','IF','FOR',
                            'YOU','WE','MUST','CAN','WILL','ONE','TWO','TIPS','FROM'],

            decorativePattern: /(spacer|divider|separator|logo|icon|bullet|pixel|blank|shim)/i
        };
    },

    // ================================================================ public

    score: function (text, options) {
        var cfg = this._cfgFor(options);
        var raw = (text === null || text === undefined) ? '' : String(text);
        var doc = this._parse(raw, cfg);

        if (doc.stats.words < cfg.minWords) {
            return this._error('EMPTY_CONTENT',
                'Not enough readable text to score: ' + doc.stats.words +
                ' words, minimum is ' + cfg.minWords + '.',
                cfg.detail ? { stats: doc.stats } : null);
        }

        var c1 = this._selfContainedness(doc, cfg);
        var c2 = this._chunkGeometry(doc, cfg);
        var c3 = this._cleanliness(doc, cfg);
        var c4 = this._completeness(doc, cfg);
        var c5 = this._referenceIntegrity(doc, cfg);

        var total = c1.points + c2.points + c3.points +
                    c4.points + c5.points;

        var out = {
            ok: true,
            error: null,
            warnings: this._foldWarnings(doc.warnings.concat(c5.warnings)),
            score: this._r2(total),
            breakdown: {
                self_containedness:  c1.points,
                chunk_geometry:      c2.points,
                cleanliness:         c3.points,
                completeness:        c4.points,
                reference_integrity: c5.points
            }
        };

        if (cfg.detail) {
            out.findings = {
                self_containedness:  c1.detail,
                chunk_geometry:      c2.detail,
                cleanliness:         c3.detail,
                completeness:        c4.detail,
                reference_integrity: c5.detail
            };
            out.stats = doc.stats;
        }

        return out;
    },

    /**
     * Score a KB article by sys_id or number.
     * Returns a hard error envelope when the article cannot be found or read.
     */
    scoreArticle: function (ref, options) {
        var cfg = this._cfgFor(options);
        var id  = String(ref === null || ref === undefined ? '' : ref).trim();

        if (!id)
            return this._error('MISSING_REFERENCE',
                'No article sys_id or number supplied.');

        if (typeof GlideRecord === 'undefined')
            return this._error('NO_SERVER_SCOPE',
                'GlideRecord is unavailable in this scope. Use score(text) instead.');

        var gr = new GlideRecord('kb_knowledge');

        if (!gr.isValid())
            return this._error('TABLE_UNAVAILABLE',
                'Table kb_knowledge is not accessible from this scope.');

        try {
            var found = /^[0-9a-f]{32}$/i.test(id) ? gr.get(id) : gr.get('number', id);
            if (!found)
                return this._error('ARTICLE_NOT_FOUND',
                    'No kb_knowledge record matched "' + id +
                    '". It may not exist, may be deleted, or may be hidden by ACLs.',
                    { ref: id });
        } catch (e) {
            return this._error('LOOKUP_FAILED',
                'kb_knowledge lookup failed for "' + id + '": ' + e, { ref: id });
        }

        var article = {
            sys_id:            String(gr.getUniqueValue()),
            number:            String(gr.getValue('number') || ''),
            short_description: String(gr.getValue('short_description') || ''),
            workflow_state:    String(gr.getValue('workflow_state') || '')
        };

        var body = String(gr.getValue('text') || '');

        if (!body.replace(/\s+/g, '').length)
            return this._error('EMPTY_ARTICLE',
                'Article ' + (article.number || id) + ' has no body text.',
                { ref: id, article: article });

        // The title is real retrieval context and gives the lead paragraph a
        // heading, so C2 does not penalise it as "text before first heading".
        if (cfg.includeTitleHeading && article.short_description)
            body = '<h1>' + article.short_description + '</h1>\n' + body;

        var result = this.score(body, options);
        result.article = article;
        return result;
    },

    // ========================================================== C1 . 30 pts

    _selfContainedness: function (doc, cfg) {
        var backRefRe = /\b(?:the above|as mentioned(?:\s+(?:earlier|above))?|mentioned above|see above|see below|see (?:the )?previous section|(?:as )?(?:described|shown|noted|discussed) (?:above|below|earlier|previously)|the (?:previous|preceding|following) (?:step|section|table|procedure)|in the (?:previous|next) section)\b/gi;

        var openers = [], i, first, pronoun;

        for (i = 0; i < doc.sections.length; i++) {
            first   = this._sentences(doc.sections[i].text)[0] || '';
            pronoun = this._danglingOpener(first);
            if (pronoun) {
                openers.push({
                    section:    doc.sections[i].heading || '(text before first heading)',
                    pronoun:    pronoun,
                    opens_with: first.substring(0, 80)
                });
            }
        }

        var backRefs  = doc.text.match(backRefRe) || [];
        var acronyms  = this._unexpandedAcronyms(doc.text, cfg);
        var hits      = openers.length + backRefs.length + acronyms.length;

        // Floor the denominator so one hit cannot zero a short document.
        var basis = Math.max(doc.stats.words, cfg.minWordsForRate);
        var per1k = hits / (basis / 1000);
        var pts   = 30 * (1 - Math.min(1, per1k / cfg.hitRateCeiling));

        return {
            points: this._clamp(pts, 30),
            detail: {
                hits: hits,
                words: doc.stats.words,
                rate_basis_words: basis,
                rate_per_1000_words: this._r2(per1k),
                ceiling: cfg.hitRateCeiling,
                dangling_openers: openers,
                back_reference_phrases: backRefs.length,
                back_reference_examples: this._uniq(backRefs).slice(0, 8),
                unexpanded_acronyms: acronyms
            }
        };
    },

    /**
     * A section opening with a bare pronoun has no antecedent inside its own
     * chunk. "This procedure ..." is fine; "This is required ..." is not.
     * Returns the offending pronoun, or null.
     */
    _danglingOpener: function (sentence) {
        var m = /^(it|its|they|their|them|such|this|that|these|those)\b\s*('?[a-z]+)?/i.exec(sentence);
        if (!m) return null;

        var pronoun = m[1].toLowerCase();
        var next    = (m[2] || '').toLowerCase().replace(/^'/, '');

        // Impersonal "it": "It is important to ..." needs no antecedent.
        if (pronoun === 'it' || pronoun === 'its') {
            if (/^it(?:'s| is| was| can be| may be| might be| would be| will be| has been)\s+(?:important|necessary|recommended|possible|worth|best|common|critical|useful|advisable|likely|unlikely|helpful|essential|good|safe|normal|expected|easy|difficult)\b/i.test(sentence))
                return null;
            return pronoun;
        }

        if (pronoun === 'they' || pronoun === 'their' ||
            pronoun === 'them'  || pronoun === 'such') return pronoun;

        // this / that / these / those: dangling only when not followed by a noun
        if (!next) return pronoun;
        return /^(?:is|are|was|were|will|would|can|could|should|shall|must|may|might|has|have|had|does|do|did|means|allows|requires|causes|includes|applies|occurs|happens|ensures|prevents|lets|gives|makes|results|works|explains|describes|shows|indicates|refers|depends|needs|appears|becomes|remains|seems|takes|creates|provides|enables|affects|s|ll|re|d)$/.test(next)
            ? pronoun : null;
    },

    _unexpandedAcronyms: function (text, cfg) {
        var out = [], seen = {}, self = this;

        this._findAll(/\b([A-Z][A-Z0-9]{1,5})(?![a-z])\b/g, text, function (m) {
            var a = m[1];
            if (seen[a]) return;
            seen[a] = true;

            if (self._inArray(cfg.knownAcronyms, a)) return;
            if (self._inArray(cfg.capsStopWords, a)) return;

            // Expanded as "Full Name (ACR)" or "ACR (Full Name)"?
            var expanded = new RegExp('\\([^)]*\\b' + a + '\\b[^)]*\\)').test(text) ||
                           new RegExp('\\b' + a + '\\s*\\(\\s*[A-Za-z][^)]{3,}\\)').test(text);

            if (!expanded) out.push(a);
        });

        return out;
    },

    // ========================================================== C2 . 25 pts

    _chunkGeometry: function (doc, cfg) {
        var validWords = 0, totalWords = 0, invalid = [], i, s, w, tokens;

        for (i = 0; i < doc.sections.length; i++) {
            s = doc.sections[i];
            w = this._words(s.text).length;
            if (w === 0) continue;

            // Take the worse of word- and character-based estimates: dense
            // content (code, tables, IDs) tokenises far worse than prose.
            tokens = Math.max(Math.round(w * cfg.tokensPerWord),
                              Math.round(s.text.length / 4));
            totalWords += w;

            var hasHeading = !!(s.heading && s.heading.length);
            if (hasHeading && tokens <= cfg.maxSectionTokens) {
                validWords += w;
            } else {
                invalid.push({
                    section: s.heading || '(text before first heading)',
                    words: w,
                    tokens: tokens,
                    reason: !hasHeading ? 'no heading' : 'over token cap'
                });
            }
        }

        var coverage = totalWords > 0 ? validWords / totalWords : 0;

        return {
            points: this._clamp(25 * coverage, 25),
            detail: {
                token_cap: cfg.maxSectionTokens,
                coverage: this._r2(coverage),
                words_in_valid_sections: validWords,
                total_words: totalWords,
                invalid_sections: invalid
            }
        };
    },

    // ========================================================== C3 . 20 pts

    /**
     * Two document-level measures, no line sampling:
     *   1. markup overhead - how much of the payload is not text
     *   2. junk density    - explicit noise patterns per 1,000 words
     * Well-formed semantic HTML scores full marks; Word-paste soup does not.
     */
    _cleanliness: function (doc, cfg) {
        var rawLen  = doc.clean.replace(/\s+/g, ' ').trim().length;
        var textLen = doc.text.replace(/\s+/g, ' ').trim().length;

        var overhead = rawLen > 0 ? 1 - Math.min(1, textLen / rawLen) : 0;
        var span     = Math.max(0.01, cfg.markupOverheadCeiling - cfg.markupOverheadFloor);
        var overheadScore = 1 - Math.min(1, Math.max(0,
                            (overhead - cfg.markupOverheadFloor) / span));

        var junk  = this._junkSignals(doc.clean);
        var basis = Math.max(doc.stats.words, cfg.minWordsForRate);
        var per1k = junk.total / (basis / 1000);
        var junkScore = 1 - Math.min(1, per1k / cfg.junkCeiling);

        var pts = 20 * (0.6 * overheadScore + 0.4 * junkScore);

        return {
            points: this._clamp(pts, 20),
            detail: {
                markup_overhead: this._r2(overhead),
                markup_overhead_band: [cfg.markupOverheadFloor, cfg.markupOverheadCeiling],
                markup_overhead_score: this._r2(overheadScore),
                text_chars: textLen,
                payload_chars: rawLen,
                junk_hits: junk.total,
                junk_per_1000_words: this._r2(per1k),
                junk_ceiling: cfg.junkCeiling,
                junk_score: this._r2(junkScore),
                junk_breakdown: junk.counts,
                junk_examples: junk.examples
            }
        };
    },

    _junkSignals: function (raw) {
        var patterns = {
            inline_styles:    /<[a-z][^>]*\sstyle\s*=/gi,
            word_artifacts:   /(?:class\s*=\s*"[^"]*Mso|<\/?o:p|<\/?w:|mso-)/gi,
            legacy_tags:      /<\/?(?:font|center|basefont|marquee|blink)\b/gi,
            empty_blocks:     /<(p|div|span)\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi,
            base64_payloads:  /src\s*=\s*["']?data:[^"'\s>]{200,}/gi,
            numeric_entities: /&#(?:x[0-9a-f]{1,6}|\d{1,7});/gi,
            zero_width_chars: /[\u200B-\u200D\uFEFF\u00AD]/g,
            div_soup:         /(?:<div\b[^>]*>\s*){4,}/gi,
            mojibake:         /(?:\u00e2\u0080|\u00c3\u00a2|\u00c2\s|\u00c3\u201a)/g
        };

        var counts = {}, examples = [], total = 0, k, hits;

        for (k in patterns) {
            if (!patterns.hasOwnProperty(k)) continue;
            hits = raw.match(patterns[k]) || [];
            counts[k] = hits.length;
            total += hits.length;
            if (hits.length && examples.length < 8)
                examples.push(k + ': ' + String(hits[0]).replace(/\s+/g, ' ').substring(0, 90));
        }

        return { total: total, counts: counts, examples: examples };
    },

    // ========================================================== C4 . 15 pts

    _completeness: function (doc, cfg) {
        var objs = doc.images.concat(doc.tables, doc.media);
        var counted = [], i;

        for (i = 0; i < objs.length; i++)
            if (!objs[i].decorative) counted.push(objs[i]);

        if (counted.length === 0) {
            return {
                points: 15,
                detail: { objects: 0, covered: 0,
                          decorative_excluded: objs.length, uncovered: [] }
            };
        }

        var covered = 0, uncovered = [];
        for (i = 0; i < counted.length; i++) {
            if (counted[i].covered) covered++;
            else uncovered.push({
                type: counted[i].type,
                detail: counted[i].label || '',
                reason: counted[i].reason
            });
        }

        return {
            points: this._clamp(15 * (covered / counted.length), 15),
            detail: {
                objects: counted.length,
                covered: covered,
                decorative_excluded: objs.length - counted.length,
                uncovered: uncovered
            }
        };
    },

    // ========================================================== C5 . 10 pts

    _referenceIntegrity: function (doc, cfg) {
        var internal = 0, resolvable = 0, malformed = 0, externalCount = 0;
        var dead = [], bad = [], warnings = [], i, href, ref, lookup;

        var canResolve = cfg.resolve_links && typeof GlideRecord !== 'undefined';
        if (cfg.resolve_links && !canResolve) {
            warnings.push({
                code: 'LINK_RESOLUTION_UNAVAILABLE',
                message: 'GlideRecord is unavailable in this scope; internal KB links were not verified and were not penalised.'
            });
        }

        for (i = 0; i < doc.links.length; i++) {
            href = (doc.links[i].href || '').trim();

            if (!href || href === '#' || /^javascript:/i.test(href) ||
                /^(?:undefined|null)$/i.test(href)) {
                malformed++;
                bad.push(href || '(empty href)');
                continue;
            }

            ref = this._kbRef(href);

            if (!ref) {
                if (/^https?:\/\//i.test(href)) externalCount++;
                continue;
            }

            internal++;

            if (!canResolve) { resolvable++; continue; }

            lookup = this._kbLookup(ref);

            if (lookup.status === 'error') {
                // A lookup we could not perform is not a content defect.
                resolvable++;
                warnings.push({
                    code: 'LINK_LOOKUP_FAILED',
                    message: 'Could not verify ' + ref + ': ' + lookup.error,
                    href: href
                });
            } else if (lookup.status === 'published') {
                resolvable++;
            } else {
                dead.push({
                    href: href,
                    ref: ref,
                    reason: lookup.status === 'not_found'
                        ? 'no kb_knowledge record found (deleted, or hidden by ACLs)'
                        : 'article exists but workflow_state is "' + lookup.state + '"',
                    workflow_state: lookup.state
                });
            }
        }

        var denom = internal + malformed;

        return {
            points: denom === 0 ? 10 : this._clamp(10 * (resolvable / denom), 10),
            warnings: warnings,
            detail: {
                total_links: doc.links.length,
                internal_kb_links: internal,
                resolvable: resolvable,
                dead_internal: dead,
                malformed: bad,
                external_excluded: externalCount,
                link_resolution: canResolve ? 'enabled'
                    : (cfg.resolve_links ? 'unavailable' : 'disabled')
            }
        };
    },

    // ============================================================ KB lookup

    _kbRef: function (href) {
        var m = /sysparm_article=([A-Za-z0-9]+)/.exec(href) ||
                /[?&]sys_id=([0-9a-f]{32})/i.exec(href) ||
                /\b(KB\d{5,})\b/.exec(href);
        return m ? m[1] : null;
    },

    /** -> { status: 'published' | 'unpublished' | 'not_found' | 'error', state, error } */
    _kbLookup: function (ref) {
        if (this._kbCache.hasOwnProperty(ref)) return this._kbCache[ref];

        var res;
        try {
            var gr = new GlideRecord('kb_knowledge');
            if (!gr.isValid()) {
                res = { status: 'error', state: null,
                        error: 'kb_knowledge is not accessible from this scope' };
            } else {
                var found = /^[0-9a-f]{32}$/i.test(ref)
                    ? gr.get(ref) : gr.get('number', ref);

                if (!found) {
                    res = { status: 'not_found', state: null, error: null };
                } else {
                    var state = String(gr.getValue('workflow_state') || '');
                    res = {
                        status: state === 'published' ? 'published' : 'unpublished',
                        state: state,
                        error: null
                    };
                }
            }
        } catch (e) {
            if (typeof gs !== 'undefined')
                gs.warn('[AIReadability] KB lookup failed for ' + ref + ': ' + e);
            res = { status: 'error', state: null, error: String(e) };
        }

        this._kbCache[ref] = res;
        return res;
    },

    // ========================================================== parse layer

    _parse: function (text, cfg) {
        var clean = String(text || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ');

        var doc = {
            raw: text, clean: clean, warnings: [],
            headings: [], sections: [],
            images: [], tables: [], media: [], links: []
        };

        doc.headings = this._collectHeadings(clean);
        doc.sections = this._buildSections(clean, doc.headings);
        doc.text     = this._strip(clean);

        this._collectImages(doc, clean, cfg);
        this._collectTables(doc, clean, cfg);
        this._collectMedia(doc, clean, cfg);
        this._collectLinks(doc, clean);

        if (doc.headings.length === 0)
            doc.warnings.push({
                code: 'NO_HEADINGS',
                message: 'No headings found; the whole document is a single unlabelled chunk.'
            });

        var mdHeadings = 0, i;
        for (i = 0; i < doc.headings.length; i++)
            if (doc.headings[i].syntax === 'markdown') mdHeadings++;

        doc.stats = {
            words: this._words(doc.text).length,
            chars: clean.length,
            sections: doc.sections.length,
            headings: doc.headings.length,
            headings_markdown: mdHeadings,
            headings_html: doc.headings.length - mdHeadings,
            images: doc.images.length,
            tables: doc.tables.length,
            media: doc.media.length,
            links: doc.links.length
        };

        return doc;
    },

    _collectHeadings: function (clean) {
        var out = [], self = this;

        this._findAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, clean, function (m) {
            var t = self._strip(m[2]).replace(/\s+/g, ' ').trim();
            if (!t) return;                       // <h3>&nbsp;</h3> is not a heading
            out.push({ level: parseInt(m[1], 10), text: t,
                       start: m.index, end: m.index + m[0].length, syntax: 'html' });
        });

        this._findAll(/(^|\n)[ \t]{0,3}(#{1,6})[ \t]+([^\n]+)/g, clean, function (m) {
            var t = m[3].replace(/[ \t]*#+[ \t]*$/, '').replace(/\s+/g, ' ').trim();
            if (!t) return;
            out.push({ level: m[2].length, text: t,
                       start: m.index + m[1].length,
                       end: m.index + m[0].length, syntax: 'markdown' });
        });

        out.sort(function (a, b) { return a.start - b.start; });

        var deduped = [], i;
        for (i = 0; i < out.length; i++) {
            if (deduped.length && out[i].start < deduped[deduped.length - 1].end) continue;
            deduped.push(out[i]);
        }
        return deduped;
    },

    _buildSections: function (clean, headings) {
        var sections = [], i;

        if (headings.length === 0) {
            return [{ heading: null, level: 0, syntax: null,
                      html: clean, text: this._strip(clean) }];
        }

        if (headings[0].start > 0) {
            var pre = clean.substring(0, headings[0].start);
            if (this._strip(pre).replace(/\s+/g, '').length > 0)
                sections.push({ heading: null, level: 0, syntax: null,
                                html: pre, text: this._strip(pre) });
        }

        for (i = 0; i < headings.length; i++) {
            var to  = (i + 1 < headings.length) ? headings[i + 1].start : clean.length;
            var seg = clean.substring(headings[i].end, to);

            sections.push({
                heading: headings[i].text,
                level:   headings[i].level,
                syntax:  headings[i].syntax,
                html:    seg,
                text:    this._strip(seg)
            });
        }

        return sections;
    },

    _collectImages: function (doc, clean, cfg) {
        var self = this;

        this._findAll(/<img\b([^>]*)>/gi, clean, function (m, end) {
            var attrs = m[1];
            var alt   = self._attrOrNull(attrs, 'alt');       // null = absent
            var src   = self._attr(attrs, 'src') || self._attr(attrs, 'data-src');
            var w     = parseInt(self._attr(attrs, 'width'), 10);
            var h     = parseInt(self._attr(attrs, 'height'), 10);
            var role  = self._attr(attrs, 'role').toLowerCase();

            var tiny = (!isNaN(w) && w > 0 && w <= cfg.decorativeMaxPx) ||
                       (!isNaN(h) && h > 0 && h <= cfg.decorativeMaxPx);

            var declaredDecorative =
                tiny ||
                role === 'presentation' || role === 'none' ||
                self._attr(attrs, 'aria-hidden').toLowerCase() === 'true' ||
                (alt === '' && cfg.decorativePattern.test(src));

            doc.images.push(self._imageEntry(
                alt, src, declaredDecorative,
                self._followingWords(clean, end, cfg), cfg));
        });

        this._findAll(/!\[([^\]]{0,300})\]\(\s*<?([^)\s>]+)>?[^)]*\)/g, clean, function (m, end) {
            doc.images.push(self._imageEntry(
                m[1], m[2],
                m[1] === '' && cfg.decorativePattern.test(m[2]),
                self._followingWords(clean, end, cfg), cfg));
        });
    },

    _imageEntry: function (alt, src, decorative, restateWords, cfg) {
        var hasAlt   = alt !== null;
        var altWords = hasAlt ? this._words(alt).length : 0;
        var covered  = this._covered(altWords, restateWords, cfg);

        var name = String(src || '');
        name = name.substring(name.lastIndexOf('/') + 1).substring(0, 60);

        var reason = null;
        if (!covered) {
            if (!hasAlt)             reason = 'no alt attribute and no prose restatement';
            else if (altWords === 0) reason = 'empty alt text and no prose restatement';
            else reason = 'alt text too short (' + altWords + ' words) and no prose restatement';
        }

        return {
            type: 'image',
            label: name || '(no src)',
            decorative: !!decorative,
            covered: covered,
            reason: reason
        };
    },

    _collectTables: function (doc, clean, cfg) {
        var self = this;

        this._findAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi, clean, function (m, end) {
            var body    = m[2];
            var rows    = (body.match(/<tr\b/gi) || []).length;
            var complex = /(?:colspan|rowspan)\s*=/i.test(body);
            var headers = /<th\b/i.test(body);
            var role    = self._attr(m[1], 'role').toLowerCase();
            var restate = self._followingWords(clean, end, cfg);

            var decorative = role === 'presentation' || role === 'none' || rows <= 1;

            var needsRestatement = complex && restate < cfg.minRestatementWords;
            var missingHeaders   = cfg.requireTableHeaders && !headers;
            var covered = !needsRestatement && !missingHeaders;

            var reason = null;
            if (!covered) {
                reason = missingHeaders
                    ? 'no <th> header cells, so column meaning is unrecoverable from text'
                    : 'merged or spanned cells with no prose restatement';
            }

            doc.tables.push({
                type: 'table',
                label: rows + ' rows' + (complex ? ', merged cells' : '') +
                       (headers ? '' : ', no headers'),
                decorative: decorative,
                covered: covered,
                reason: reason
            });
        });
    },

    _collectMedia: function (doc, clean, cfg) {
        var self = this;

        this._findAll(/<(iframe|video|object|embed)\b([^>]*)>/gi, clean, function (m, end) {
            var restate = self._followingWords(clean, end, cfg);
            var covered = restate >= cfg.minRestatementWords;

            doc.media.push({
                type: m[1].toLowerCase(),
                label: (self._attr(m[2], 'src') || self._attr(m[2], 'data')).substring(0, 60),
                decorative: self._attr(m[2], 'aria-hidden').toLowerCase() === 'true',
                covered: covered,
                reason: covered ? null : 'embedded media with no text equivalent nearby'
            });
        });
    },

    _collectLinks: function (doc, clean) {
        var self = this;

        this._findAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, clean, function (m) {
            doc.links.push({
                href:   self._attr(m[1], 'href'),
                anchor: self._strip(m[2]).replace(/\s+/g, ' ').trim(),
                syntax: 'html'
            });
        });

        // Leading "!" is captured rather than consumed, so adjacent links
        // like [a](x)[b](y) are both found.
        this._findAll(/(!?)\[([^\]\n]{1,300})\]\(\s*<?([^)\s>]+)>?[^)]*\)/g, clean, function (m) {
            if (m[1] === '!') return;                              // image
            if (clean.charAt(m.index - 1) === '\\') return;         // escaped
            doc.links.push({
                href:   m[3],
                anchor: m[2].replace(/\s+/g, ' ').trim(),
                syntax: 'markdown'
            });
        });

        this._findAll(/<((?:https?|mailto):[^>\s]+)>/gi, clean, function (m) {
            doc.links.push({ href: m[1], anchor: m[1], syntax: 'autolink' });
        });
    },

    /**
     * Words of prose following an object, measured in TEXT words and stopped
     * at the next block object so one caption cannot cover two figures.
     */
    _followingWords: function (clean, fromIndex, cfg) {
        var slice = clean.substring(fromIndex,
                        fromIndex + cfg.restatementWindowWords * 40);

        var stop = slice.search(/<(?:img|table|iframe|video|object|embed|h[1-6])\b|!\[/i);
        if (stop > -1) slice = slice.substring(0, stop);

        return Math.min(this._words(this._strip(slice)).length,
                        cfg.restatementWindowWords);
    },

    _covered: function (altWords, restateWords, cfg) {
        return altWords >= cfg.minAltWords ||
               restateWords >= cfg.minRestatementWords;
    },

    // ================================================================ utils

    /** One exec loop for every collector, with a zero-length-match guard. */
    _findAll: function (re, text, cb) {
        var m;
        re.lastIndex = 0;
        while ((m = re.exec(text)) !== null) {
            cb(m, re.lastIndex);
            if (m[0].length === 0) re.lastIndex++;
        }
    },

    _decode: function (s) {
        var named = {
            nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
            ndash: '-', mdash: '-', hellip: '...', bull: '\u2022',
            rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
            euro: '\u20AC', pound: '\u00A3', deg: '\u00B0', middot: '\u00B7',
            trade: '', reg: '', copy: ''
        };

        return String(s)
            .replace(/&#x([0-9a-f]{1,6});/gi, function (all, h) {
                return String.fromCharCode(parseInt(h, 16));
            })
            .replace(/&#(\d{1,7});/g, function (all, d) {
                return String.fromCharCode(parseInt(d, 10));
            })
            .replace(/&([a-z][a-z0-9]{1,10});/gi, function (all, n) {
                var k = n.toLowerCase();
                return named.hasOwnProperty(k) ? named[k] : ' ';
            });
    },

    _strip: function (s) {
        return this._decode(
                String(s || '')
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<\/(?:p|div|li|tr|h[1-6]|td|th|ul|ol|table|blockquote|section|article)>/gi, '\n')
                    .replace(/<[^>]+>/g, ' ')
            )
            .replace(/(^|\n)[ \t]{0,3}#{1,6}[ \t]+/g, '$1')
            .replace(/(^|\n)[ \t]{0,3}>[ \t]?/g, '$1')
            .replace(/(^|\n)[ \t]{0,3}([-*_])[ \t]*\2[ \t]*\2[-*_ \t]*(?=\n|$)/g, '$1')
            .replace(/(^|\n)[ \t]*\|/g, '$1')
            .replace(/\|/g, ' ')
            .replace(/(^|\n)[ \t]{0,3}[-*+][ \t]+/g, '$1')
            .replace(/\*\*|__|`{1,3}|~~/g, '')
            .replace(/[ \t]+/g, ' ');
    },

    _words: function (text) {
        var t = String(text || '').replace(/\s+/g, ' ').trim();
        return t ? t.split(' ') : [];
    },

    _sentences: function (text) {
        var t = String(text || '').replace(/\s+/g, ' ').trim();
        if (!t) return [];

        // Mask abbreviation periods so they do not split sentences.
        t = t.replace(/\b(?:e\.g|i\.e|etc|vs|approx|Mr|Mrs|Ms|Dr|Fig|No|Inc|Ltd|Jr|Sr|St|min|max|sec)\./gi,
                function (a) { return a.replace(/\./g, '\u0002'); });

        var parts = t.replace(/([.!?])\s+/g, '$1\u0001').split('\u0001');
        var out = [], i, p;
        for (i = 0; i < parts.length; i++) {
            p = parts[i].replace(/\u0002/g, '.').trim();
            if (p) out.push(p);
        }
        return out;
    },

    /** null when the attribute is absent; '' when present but empty. */
    _attrOrNull: function (attrStr, name) {
        var m = new RegExp('(?:^|\\s)' + name +
                    '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]*))', 'i')
                .exec(attrStr || '');
        if (!m) return null;
        var v = m[1] !== undefined ? m[1]
              : (m[2] !== undefined ? m[2] : (m[3] || ''));
        return v.trim();
    },

    _attr: function (attrStr, name) {
        var v = this._attrOrNull(attrStr, name);
        return v === null ? '' : v;
    },

    /** Per-call config; never mutates instance state. */
    _cfgFor: function (options) {
        return options ? this._merge(this.cfg, options) : this.cfg;
    },

    _merge: function (base, over) {
        var k, out = {};
        for (k in base) if (base.hasOwnProperty(k)) out[k] = base[k];
        for (k in over) if (over.hasOwnProperty(k)) out[k] = over[k];
        return out;
    },

    _error: function (code, message, extra) {
        var out = {
            ok: false,
            error: { code: code, message: message },
            warnings: [],
            score: null,
            breakdown: null
        };
        extra = extra || {};
        for (var k in extra) if (extra.hasOwnProperty(k)) out[k] = extra[k];
        return out;
    },

    /** Collapse warnings to one per code, with a count. */
    _foldWarnings: function (list) {
        var seen = {}, out = [], i, w, folded;
        for (i = 0; i < list.length; i++) {
            w = list[i];
            if (seen.hasOwnProperty(w.code)) { seen[w.code].count++; continue; }
            folded = { code: w.code, message: w.message, count: 1 };
            seen[w.code] = folded;
            out.push(folded);
        }
        return out;
    },

    _uniq: function (arr) {
        var seen = {}, out = [], i, k;
        for (i = 0; i < arr.length; i++) {
            k = String(arr[i]).toLowerCase();
            if (!seen[k]) { seen[k] = true; out.push(arr[i]); }
        }
        return out;
    },

    _inArray: function (arr, v) {
        for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true;
        return false;
    },

    _clamp: function (n, max) {
        return Math.round(Math.max(0, Math.min(max, n)) * 100) / 100;
    },

    _r2: function (n) { return Math.round(n * 100) / 100; },

    type: 'AIReadabilityScorer'
};