const RefineryLLM = {
    CAPABILITY_ID: "c2b82f393b8f83106479ff7e53e45aa0",
    SKILL_CONFIG_ID: "a2b8af393b8f83106479ff7e53e45ad3"
};

const model = "opus";

let counter = 1;


const items = [];
for (let i = 0; i < 2; i++) {
    const chat_history = [
        {
            role: 'user',
            content: [{
                "type": "text",
                "text": `Hello, this is test numer #${counter}`
            }]
        }
    ];
    const payload = {
        __chat_history: chat_history
    };

    items.push({
        payload: payload,
        userData: {
            counter: counter
        }
    });
    counter++;
}

(function (items) {
    var executionRequests = items.map(function (item) {
        return {
            payload: item.payload,
            capabilityId: RefineryLLM.CAPABILITY_ID,
            meta: {
                skillConfigId: RefineryLLM.SKILL_CONFIG_ID,
                source: 'Knowledge Refinery',
                user_data: item.userData,
                configFilters: { model: model }
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

    gs.info(`[Gilad] response: ${JSON.stringify(response, null, 4)}`);

    if (response && response.status === 'error') {
        throw {
            message: 'RefineryLLM.dispatchBatch: top-level OneExtend error: ' + (response.message || 'unknown error'),
            code: response.errorCode || 'UNKNOWN_ERROR'
        };
    }
})(items);