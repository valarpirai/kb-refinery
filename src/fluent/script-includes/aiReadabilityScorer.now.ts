import { ScriptInclude } from '@servicenow/sdk/core'

export const aiReadabilityScorer = ScriptInclude({
    $id: Now.ID['x_snc_kb_refinery_ai_readability_scorer-script-include'],
    name: 'AIReadabilityScorer',
    script: Now.include('./aiReadabilityScorer.server.js'),
    apiName: 'x_snc_kb_refinery.AIReadabilityScorer',
    clientCallable: false,
    mobileCallable: false,
    sandboxCallable: false,
    active: true,
})
