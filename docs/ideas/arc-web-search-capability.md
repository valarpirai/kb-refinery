# Arc Web Search — How It Works & How to Replicate It

## Overview

Arc's UI has a "Web search" toggle in the composer's `+` menu. It gives the agent live, grounded
web search results instead of relying on training data. Depending on the LLM provider, it's
implemented one of two ways:

| Provider | Mode | Implementation |
|---|---|---|
| GAIC (ServiceNow) | `Tool` | Custom `web_search` tool → ServiceNow `invokeLLMForARC` REST endpoint → OneExtend "AI Websearch" capability |
| Anthropic | `Native` | Server-side tool `{"type": "web_search_20250305", "name": "web_search"}` added directly to the API request |
| OpenAI | `Native` | `{"type": "web_search_preview"}` added to the API request |
| Google | `Native` | Google Search grounding tool added to the API request |

This doc focuses on the **GAIC path**, since that's the one with custom implementation worth
replicating elsewhere.

---

## Frontend (toggle)

- `src/components/ComposerMenu.tsx` — "Web search" checkbox menu item (`role="menuitemcheckbox"`).
- `src/components/AgentMain.tsx` — wires `webSearchEnabled={settings().webSearchEnabled ?? true}`.
- `src/stores/settings.ts` — persists as `webSearchEnabled` (default `true`), sent to backend as
  `web_search_enabled`.

## Backend gating

`src-tauri/crates/arc-server/src/handlers/agent.rs` resolves a `WebSearchMode`
(`Off` / `Tool` / `Native`) from provider + toggle. If mode isn't `Tool`, the `web_search` tool is
stripped from the tool list before the request goes to the model
(`agent/system_prompt.rs::WebSearchMode::resolve`).

---

## End-to-end flow (GAIC path)

```
Arc agent (Rust)                ServiceNow REST                ArcUtil (script include)          OneExtend
─────────────────                ─────────────────               ──────────────────────           ─────────
web_search tool call
  → POST /invokeLLMForARC  ───►  operation_script routes:
                                   requestBody.query present?
                                     yes → invokeLLMForWebSearch()  ───►  executeSecure({
                                     no  → invokeLLM() (chat)              executionRequests: [{
                                                                              payload: { query },
                                                                              capabilityId: WEB_SEARCH_CAPABILITY_ID
                                                                            }]
                                                                          })  ───────────────────►  runs capability,
                                                                                                     returns
                                                                                                     { capabilities: {
                                                                                                         [capId]: {...}
                                                                                                     }}
```

---

## 1. Rust tool: `src-tauri/crates/arc-core/src/tools/web_search.rs`

```rust
//! `web_search` tool — live web search via the ServiceNow AI Websearch skill.
//!
//! Sends the query to the connected instance's `invokeLLMForARC` scripted REST
//! endpoint. When the request body carries a `query`, the endpoint routes it to
//! the ServiceNow AI Websearch capability (rather than the chat capability) and
//! returns a grounded answer with its sources. This tool returns that answer
//! plus the source list (title, url).

pub const TOOL_NAME: &str = "web_search";
const REQUEST_TIMEOUT_SECS: u64 = 120;

pub async fn execute(
    input: &serde_json::Value,
    integration_manager: &Arc<IntegrationManager>,
) -> Result<String, String> {
    let query = input
        .get("query")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .ok_or("Missing required 'query' parameter")?;

    // Resolve auth header + base URL from the sole connected ServiceNow instance.
    let (auth_value, base_url) =
        crate::llm_client::gaic::resolve_gaic_auth(integration_manager)
            .await
            .map_err(|e| format!("web_search: GAIC auth unavailable: {}", e))?;

    // The `invokeLLMForARC` endpoint routes a `query` body to the AI Websearch
    // capability. Same endpoint the chat path uses (honors ARC_GAIC_PATH).
    let url = crate::llm_client::gaic::build_gaic_url(&base_url);
    let payload = json!({ "query": query });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("web_search: failed to build HTTP client: {}", e))?;

    let mut request = client.post(&url);
    for (key, value) in crate::llm_client::gaic::build_gaic_headers(&auth_value) {
        request = request.header(&key, &value);
    }

    let response = request.json(&payload).send().await
        .map_err(|e| format!("web_search: request to ServiceNow failed: {}", e))?;

    let status = response.status();
    let body = response.text().await
        .map_err(|e| format!("web_search: failed to read ServiceNow response: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "web_search: ServiceNow HTTP {}: {}",
            status.as_u16(),
            crate::utils::truncate_str(&body, 500)
        ));
    }

    let data: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("web_search: invalid JSON from ServiceNow: {}", e))?;

    let result = parse_web_search_response(query, &data)?;

    serde_json::to_string_pretty(&result)
        .map_err(|e| format!("web_search: failed to serialize result: {}", e))
}

/// Parse the AI Websearch response into the tool's output contract:
/// `{ query, answer, sources[{title, url}] }`.
fn parse_web_search_response(
    query: &str,
    data: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let result = data.get("result").unwrap_or(data);

    // Surface a server-reported error status (message lives on the error branch).
    if result.get("status").and_then(|v| v.as_str()) == Some("error") {
        let msg = result
            .get("message")
            .and_then(|v| v.as_str())
            .or_else(|| result.get("error").and_then(|e| e.as_str()))
            .or_else(|| result.get("error").and_then(|e| e.get("message")).and_then(|v| v.as_str()))
            .unwrap_or("unknown error");
        return Err(format!("web_search: ServiceNow web search error: {}", msg));
    }

    // `result.response.response` is an array of answer objects; the first holds
    // the grounded answer + its sources. NOTE the double nesting.
    let first = result
        .get("response")
        .and_then(|r| r.get("response"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first());

    let answer = first
        .and_then(|f| f.get("answer"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let sources: Vec<serde_json::Value> = first
        .and_then(|f| f.get("groundingChunks"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|c| {
                    json!({
                        "title": c.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "url": c.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    // Defensive: treat a technically-"success" but empty response as an error.
    if answer.is_empty() && sources.is_empty() {
        return Err(format!(
            "web_search: ServiceNow returned no answer and no sources: {}",
            crate::utils::truncate_str(&data.to_string(), 500)
        ));
    }

    Ok(json!({ "query": query, "answer": answer, "sources": sources }))
}
```

Tool definition (schema exposed to the LLM):
```json
{
  "name": "web_search",
  "description": "Search the live web for current information and get back a grounded answer with its sources. ... Returns { answer, sources: [{title, url}] }.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "The search query — a focused natural-language question or set of keywords." }
    },
    "required": ["query"]
  }
}
```

---

## 2. ServiceNow REST endpoint: `/invokeLLMForARC`

Scripted REST API resource, table `sys_ws_operation`, under web service "Arc (Internal API)" v1,
path `/invokeLLMForARC`.

```js
/**
 * REST API endpoint to invoke LLM for ServiceNow Arc.
 * Accepts a POST request with model and chat history, executes OneExtend, and returns the LLM response.
 */
(function process(request, response) {

    try {
        const requestBody = request.body.data;
        if (!requestBody) {
            response.setStatus(400);
            response.setBody({ status: 'error', errorCode: 'INVALID_REQUEST', message: 'Request body is empty or missing' });
            return;
        }

        const arcUtil = new ArcUtil();
        const llmResponse = requestBody.query ? arcUtil.invokeLLMForWebSearch(requestBody) : arcUtil.invokeLLM(requestBody);
        if (llmResponse.status === 'error') {
            const err = llmResponse.error || {};
            // 403 — permanent permission failure, never retry.
            // 400 — permanent provider / parameter error (has a specific errorCode), never retry.
            // 502 — transient upstream failure (no errorCode), Arc's retry loop handles these.
            let httpStatus = 502;
            if (err.errorCode === ArcConstants.SKILL_ACCESS_DENIED) {
                httpStatus = 403;
            } else if (err.errorCode && err.errorCode !== 'UNKNOWN_ERROR') {
                httpStatus = 400;
            }
            response.setStatus(httpStatus);
            response.setBody({ status: 'error', errorCode: err.errorCode || 'UNKNOWN_ERROR', message: err.message || 'An unknown error occurred' });
            return;
        }
        // sessionId present → streaming: 202 + channel. No sessionId → sync: 200 + full response.
        response.setStatus(llmResponse.status === 'streaming' ? 202 : 200);
        response.setBody(llmResponse);
    } catch (ex) {
        response.setStatus(500);
        response.setBody({
            status: 'error',
            errorCode: ex.errorCode || ex.code || 'UNKNOWN_ERROR',
            message: ex.message || 'An unknown error occurred'
        });
    }

})(request, response);
```

**The routing rule is one line**: presence of `requestBody.query` decides websearch vs. chat.

**Error → HTTP status mapping** (this is the resilience contract downstream clients rely on):

| errorCode | HTTP | Meaning |
|---|---|---|
| `SKILL_ACCESS_DENIED` | 403 | permanent — never retry |
| any other named code | 400 | permanent, provider/param error — never retry |
| `UNKNOWN_ERROR` / none | 502 | transient — client should retry |

---

## 3. Script Include: `ArcUtil` (`sn_app_arc.ArcUtil`)

### Constants (`ArcConstants`)
```js
ArcConstants.WEB_SEARCH_CAPABILITY_ID = '5817eb2b9f36121029ead63a6a0a1c7c';
ArcConstants.ONEEXTEND_CAPABILITY_ID  = '17196f9e3bb04710b6862eb693e45a17'; // chat capability, for contrast
ArcConstants.ONEEXTEND_ERROR_STATUS   = 'error';
ArcConstants.SKILL_ACCESS_DENIED      = 'skill_access_denied';
```

### The websearch method itself
```js
/**
 * Invokes the existing GAIC web search capability.
 * @param {Object} requestData - JSON with a `query` string to search for.
 * @returns {Object} Success: { status: 'success', response: capabilityObject }
 *                   Error:   { status: 'error', error: { errorCode, message } }
 */
invokeLLMForWebSearch: function(requestData) {
    try {
        const oneExtendBody = {
            executionRequests: [{
                payload: {
                    query: requestData?.query || ''
                },
                capabilityId: ArcConstants.WEB_SEARCH_CAPABILITY_ID
            }]
        };
        const oneExtendResponse = sn_one_extend.OneExtendUtil.executeSecure(oneExtendBody);
        if (oneExtendResponse.status === ArcConstants.ONEEXTEND_ERROR_STATUS) {
            throw {
                message: oneExtendResponse.message || gs.getMessage('OneExtend request failed with no additional error detail from the upstream call.'),
                errorCode: oneExtendResponse.errorCode || 'UNKNOWN_ERROR'
            };
        }
        const result = this._validateOneExtendResponse(oneExtendResponse, ArcConstants.WEB_SEARCH_CAPABILITY_ID);
        return {
            status: 'success',
            response: result
        };
    } catch (err) {
        return {
            status: 'error',
            error: {
                errorCode: err.errorCode || err.code || 'UNKNOWN_ERROR',
                message: err.message || 'An unknown error occurred'
            }
        };
    }
},
```

### The shared response validator
```js
/**
 * This method validates the one extend response and returns the llm response.
 * @param {Object} oneExtendResponse : Response of OneExtend API.
 * @param {string} [capabilityId] : Capability whose result should be extracted; defaults to the chat capability.
 * @returns {Object} JSON object that contains LLM Response (or) Error details from oneExtend.
 */
_validateOneExtendResponse: function(oneExtendResponse, capabilityId) {
    const { capabilities } = oneExtendResponse;
    const capabilityObject = capabilities[capabilityId || ArcConstants.ONEEXTEND_CAPABILITY_ID];
    const status = capabilityObject?.status;

    // if llmResponse is empty consider it as error
    if (status === ArcConstants.ONEEXTEND_ERROR_STATUS) {
        throw {
            message: capabilityObject.error || gs.getMessage('OneExtend API response is empty'),
            errorCode: capabilityObject.errorCode,
        };
    }
    return capabilityObject;
},
```

### Contrast with the chat path (`executeOneExtend` / `invokeLLM`)

The chat capability call is materially heavier — it sets a `timeout`, picks a provider `filter`
based on model, and carries `function_call_request` / `__chat_history` / streaming (`sessionId`).
**None of that exists on the websearch payload.** Don't carry that complexity over by habit —
websearch really is just `{ executionRequests: [{ payload: { query }, capabilityId }] }`.

```js
executeOneExtend: function(requestData, channelId) {
    try {
        let model = requestData?.model || ArcConstants.SONNET_MODEL;
        let filter = { "provider": "Amazon BedrockAmazon Bedrock Chat Completions" };
        if (model === ArcConstants.GEMINI_FLASH_MODEL || model === ArcConstants.GEMINI_PRO_MODEL) {
            filter = { "provider": "Google Cloud Vertex AIChat Completions" };
        } else if (model === ArcConstants.GPT_5_4_MODEL) {
            filter = { "provider": "Azure OpenAIChat Completions" };
        }
        const fcr = Object.assign({}, requestData && requestData.function_call_request ? requestData.function_call_request : {});
        if (Array.isArray(fcr.tools) && fcr.tools.length === 0) {
            delete fcr.tools; // OneExtend rejects tools: [] — omit the key entirely when empty.
        }
        const oneExtendBody = {
            timeout: 300,
            executionRequests: [{
                payload: { function_call_request: fcr, /* ...model/history/filter... */ },
                capabilityId: ArcConstants.ONEEXTEND_CAPABILITY_ID
            }]
        };
        // ...
    } catch (ex) {
        return { status: ArcConstants.ONEEXTEND_ERROR_STATUS, message, errorCode };
    }
},
```

---

## Three distinct error surfaces — the part most reimplementations miss

1. **Exception thrown by `executeSecure` itself** (e.g. connection timeout) — caught in `try/catch`
   inside `invokeLLMForWebSearch`, wrapped as `{status:'error', error:{errorCode, message}}`.
2. **Top-level transport error** — `executeSecure` *returns* (doesn't throw)
   `{status: 'error', message, errorCode}` when OneExtend's own dispatch failed before reaching
   the capability.
3. **Capability-level error** — `capabilities[capabilityId].status === 'error'` — the capability
   ran but the search itself failed (e.g. `NO_RESULTS`). Unwrapped by `_validateOneExtendResponse`.

Each has its own message/errorCode fallback chain, pinned by unit tests (e.g. exact fallback
string `'OneExtend API response is empty'` when a capability error has no message).

---

## Running the capability call directly (background script)

Paste into **System Definition > Scripts – Background** on the instance
(needs `sn_one_extend` scope access):

```js
// Option A: call OneExtend directly, bypassing ArcUtil entirely
var oneExtendBody = {
    executionRequests: [{
        payload: {
            query: 'What is the latest ServiceNow release version?'
        },
        capabilityId: '5817eb2b9f36121029ead63a6a0a1c7c' // ArcConstants.WEB_SEARCH_CAPABILITY_ID
    }]
};

var result = sn_one_extend.OneExtendUtil.executeSecure(oneExtendBody);
gs.info(JSON.stringify(result, null, 2));
```

```js
// Option B: go through ArcUtil (matches what the REST endpoint actually does)
var arcUtil = new global.ArcUtil(); // api_name: sn_app_arc.ArcUtil
var result = arcUtil.invokeLLMForWebSearch({ query: 'What is the latest ServiceNow release version?' });
gs.info(JSON.stringify(result, null, 2));
```

Response shape: `result.capabilities['5817eb2b9f36121029ead63a6a0a1c7c']` → status + the grounded
answer, matching what `web_search.rs` parses as `result.response.response[0].{answer, groundingChunks}`.

**Or hit the REST endpoint itself** (what Arc's client actually calls):
```bash
curl -s -u '<user>:<password>' \
  -H 'Content-Type: application/json' \
  -X POST \
  'https://<instance>.service-now.com/api/sn_app_arc/v1/arc/invokeLLMForARC' \
  -d '{"query": "What is the latest ServiceNow release version?"}'
```

---

## Checklist for replicating this in another project

1. **Find the equivalent capability ID** on your target instance/OneExtend/GAIC config —
   `5817eb2b9f36121029ead63a6a0a1c7c` is specific to this instance's registered "AI Websearch"
   capability; it won't transfer as-is elsewhere.
2. **Call `executeSecure`, not an elevated `execute`** — runs scoped to the calling user's own
   permissions. Your calling context needs its own grant to that capability.
3. **Keep the payload minimal** — no `timeout`, no `filter`, no session/streaming. It's a single
   synchronous request: `{ executionRequests: [{ payload: { query }, capabilityId }] }`.
4. **Handle all three error surfaces** (exception / top-level status / per-capability status), not
   just one.
5. **Preserve the errorCode → HTTP status mapping** (403 permanent / 400 permanent / 502
   transient-retryable) if you want retry logic downstream to work correctly.
6. **Expect the double-nested response shape** (`response.response[0]`) and treat
   empty-answer-and-empty-sources as a failure case even when the server reports `status: success`.
7. **Validate `query` is non-empty before sending** — cheap client-side guard, saves a round trip.
