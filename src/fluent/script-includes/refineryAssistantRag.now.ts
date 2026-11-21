import { ScriptInclude } from '@servicenow/sdk/core'

// Real scripted RAG search (sn_search.RAGRetrievalAPI) -- see
// refineryAssistantRag.server.js's own header comment and its
// KB_SOURCES registry. Only the 'generic' source is wired to a real AI
// Search profile today; 'converted'/'enriched' are still placeholders
// there, not here.
export const refineryAssistantRag = ScriptInclude({
    $id: Now.ID['x_snc_kb_refinery_assistant_rag-script-include'],
    name: 'RefineryAssistantRag',
    script: Now.include('./refineryAssistantRag.server.js'),
    apiName: 'x_snc_kb_refinery.RefineryAssistantRag',
    clientCallable: false,
    mobileCallable: false,
    sandboxCallable: false,
    active: true,
})
