var RefineryLLM = Class.create();
RefineryLLM.prototype = {
    initialize: function () {
    },

    type: 'RefineryLLM'
};

/**
 * The Now Assist Skill this pipeline calls ("Knowledge Refinery" -- see
 * src/fluent/generated/now-assist/skill/sn_nowassist_skill_config_*.now.ts).
 * Every call site in the pipeline goes through RefineryLLM.dispatchBatch, so
 * this is the only file that needs updating if the Skill is ever recreated.
 */
RefineryLLM.CAPABILITY_ID = 'c2b82f393b8f83106479ff7e53e45aa0';
RefineryLLM.SKILL_CONFIG_ID = 'a2b8af393b8f83106479ff7e53e45ad3';

/**
 * Dispatches one batch of prompts as a single async OneExtend call -- one
 * executionRequests entry per item, mode: 'async', callbackHandler pointing at
 * RefineryLLMCallback. Fire-and-forget: results never come back as this
 * function's return value, only later via RefineryLLMCallback.processCompleted/
 * processErrored/processCancelled.
 *
 * Every execution request's meta.user_data carries whatever the caller needs to
 * correlate that specific result back to a record once it comes back -- see
 * RefineryOrchestrator's per-phase _build*Item functions.
 *
 * Each item is either a plain one-shot prompt (`promptText`) or, for a future
 * multi-turn need, a full chat history (`chatHistory`, in the skill's own
 * `__chat_history` shape -- see docs/examples/) -- no current call site sets
 * the latter, but the shape is confirmed to work against this Skill.
 *
 * @param {Array<{promptText?: string, chatHistory?: Array, userData: Object}>} items
 * @throws {{message, code}} on a dispatch-time failure only (executeSecure
 *   itself throwing, or an immediate top-level {status:'error'} before any
 *   async work starts) -- callers must treat this the same as a failed batch,
 *   since no callback will ever arrive for it.
 */
RefineryLLM.dispatchBatch = function (items) {
    var executionRequests = items.map(function (item) {
        var payload = item.chatHistory
            ? { __chat_history: item.chatHistory }
            : { prompt: item.promptText };
        return {
            payload: payload,
            capabilityId: RefineryLLM.CAPABILITY_ID,
            meta: {
                skillConfigId: RefineryLLM.SKILL_CONFIG_ID,
                source: 'Knowledge Refinery',
                user_data: item.userData
            }
        };
    });

    var request = {
        executionRequests: executionRequests,
        mode: 'async',
        callbackHandler: 'x_snc_kb_refinery.RefineryLLMCallback'
    };

    var response;
    try {
        response = sn_one_extend.OneExtendUtil.executeSecure(request);
    } catch (e) {
        throw { message: 'RefineryLLM.dispatchBatch: executeSecure threw: ' + e, code: 'EXCEPTION' };
    }

    if (response && response.status === 'error') {
        throw {
            message: 'RefineryLLM.dispatchBatch: top-level OneExtend error: ' + (response.message || 'unknown error'),
            code: response.errorCode || 'UNKNOWN_ERROR'
        };
    }
};

/**
 * Strips a ```json ... ``` fence if present, then JSON.parse. Used by
 * RefineryLLMCallback. Delegates to RefineryJsonUtil, which -- unlike a plain
 * JSON.parse -- never throws: on a parse failure it returns the original
 * string unchanged, so callers must check `typeof result === 'object'`
 * rather than relying on a try/catch to detect a bad reply.
 */
RefineryLLM.parseJsonReply = function (text) {
    return RefineryJsonUtil.safeJSONParse(text);
};

/**
 * Synchronous single-call variant of dispatchBatch, against the same
 * "Knowledge Refinery" Skill (see CAPABILITY_ID/SKILL_CONFIG_ID above) --
 * for a call site that needs the model's reply back within the same script
 * execution (e.g. a chat widget's server action), rather than
 * dispatchBatch's async + RefineryLLMCallback round trip built for the
 * pipeline's batch jobs.
 *
 * mode: 'sync' + plain OneExtendUtil.execute() (not executeSecure) is a
 * confirmed *working request shape* -- confirmed against a real, live call
 * in a different app on this same instance, using the same
 * executionRequests/capabilityId/meta.skillConfigId contract. It has NOT
 * been live-tested yet against this app's own "Knowledge Refinery"
 * skill/capability specifically -- verify on first real use (gs.info the
 * raw `response` once) rather than trusting _extractSyncText's fallback
 * chain blindly.
 *
 * @param {{promptText?: string, chatHistory?: Array}} item - same
 *   promptText/chatHistory shape as one dispatchBatch item (see its own doc
 *   comment) -- chatHistory here is likewise unverified for a sync call.
 * @returns {string} the model's raw text reply
 * @throws {{message, code}} on a dispatch-time failure, or when no usable
 *   reply text could be found in the response (see _extractSyncText).
 */
RefineryLLM.dispatchSync = function (item) {
    var payload = item.chatHistory
        ? { __chat_history: item.chatHistory }
        : { prompt: item.promptText };

    var request = {
        executionRequests: [{
            payload: payload,
            capabilityId: RefineryLLM.CAPABILITY_ID,
            meta: {
                skillConfigId: RefineryLLM.SKILL_CONFIG_ID,
                source: 'Knowledge Refinery'
            }
        }],
        mode: 'sync'
    };

    var response;
    try {
        response = sn_one_extend.OneExtendUtil.execute(request);
    } catch (e) {
        throw { message: 'RefineryLLM.dispatchSync: execute threw: ' + e, code: 'EXCEPTION' };
    }

    var text = RefineryLLM._extractSyncText(response);
    if (text === null) {
        gs.warn('[Refinery] RefineryLLM.dispatchSync: could not extract reply text from response: ' + JSON.stringify(response));
        throw { message: 'RefineryLLM.dispatchSync: no usable reply text in response', code: 'NO_REPLY' };
    }
    return text;
};

/**
 * Best-effort extraction across the response shapes seen for this API so
 * far, tried in order -- returns null (never throws) rather than picking
 * one shape and letting a mismatch surface as a confusing downstream error:
 *
 * 1. response.capabilities[capabilityId].response -- confirmed for a real
 *    mode: 'sync' OneExtendUtil.execute() call, but against a *different*
 *    skill/capability in a different app. Tried first since it's the only
 *    shape confirmed for mode: 'sync' specifically.
 * 2. response.result[key].result.response / .message -- this app's own
 *    confirmed shape, but only confirmed for the *async* callback path
 *    (RefineryLLMCallback._extractResultItems). Kept as a fallback in case
 *    OneExtendUtil normalizes sync responses the same way for this skill.
 * 3. response.response / response.message -- a plain top-level guess, last
 *    resort.
 */
RefineryLLM._extractSyncText = function (response) {
    if (!response) return null;

    try {
        var cap = response.capabilities && response.capabilities[RefineryLLM.CAPABILITY_ID];
        if (cap && !gs.nil(cap.response)) return String(cap.response);
    } catch (e) {
        // fall through to the next shape
    }

    try {
        if (response.result) {
            var keys = Object.keys(response.result);
            for (var i = 0; i < keys.length; i++) {
                var resultObj = response.result[keys[i]];
                var text = resultObj && resultObj.result && (resultObj.result.response || resultObj.result.message);
                if (!gs.nil(text)) return String(text);
            }
        }
    } catch (e2) {
        // fall through to the next shape
    }

    try {
        if (!gs.nil(response.response)) return String(response.response);
        if (!gs.nil(response.message)) return String(response.message);
    } catch (e3) {
        // fall through
    }

    return null;
};
