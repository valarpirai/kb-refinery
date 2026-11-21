var RefineryJsonUtil = Class.create();
RefineryJsonUtil.prototype = {
    initialize: function () {
    },

    type: 'RefineryJsonUtil'
};

/**
 * Strips a ```json ... ``` (or plain ``` ... ```) fence from around a model
 * reply, if one is present. Mirrors the platform's own AIGC response-parsing
 * convention (kept as a local copy in this app's own scope rather than a
 * cross-scope call -- see kb-refinery-domain.md).
 * @param {string} response
 * @param {string} [suffix] - the fence-language tag to look for, e.g. 'json'.
 * @returns {string} the un-fenced content, or the original string unchanged
 *   if no fence was found.
 */
RefineryJsonUtil.stripResponseEnclosures = function (response, suffix) {
    suffix = suffix || 'json';
    var scriptStartIndex = response.indexOf('```');
    if (scriptStartIndex > -1) {
        var prefixLength = 3;
        var jsonStarterIndex = response.indexOf('```' + suffix);
        if (jsonStarterIndex === scriptStartIndex) {
            prefixLength = 7;
        }
        response = response.substring(scriptStartIndex + prefixLength);
        var scriptEndIndex = response.lastIndexOf('```');
        if (scriptEndIndex > -1) {
            response = response.substring(0, scriptEndIndex - 1);
        }
    }
    return response;
};

/**
 * Strips a fenced enclosure (see stripResponseEnclosures) then JSON.parse's
 * the result. Never throws -- on any parse failure it returns the original
 * string unchanged, so a caller must check `typeof result === 'object'` to
 * tell a real parse from a failed one.
 * @param {string} str
 * @param {boolean} [skipStripEnclosure] - parse `str` as-is, skipping the
 *   fence-stripping step.
 * @returns {Object|Array|string} the parsed value, or the original string on failure.
 */
RefineryJsonUtil.safeJSONParse = function (str, skipStripEnclosure) {
    try {
        return JSON.parse(skipStripEnclosure ? str : RefineryJsonUtil.stripResponseEnclosures(str));
    } catch (e) {
        return str;
    }
};
