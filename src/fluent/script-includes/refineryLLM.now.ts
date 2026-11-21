import { ScriptInclude } from '@servicenow/sdk/core'

export const refineryLLM = ScriptInclude({
    $id: Now.ID['x_snc_kb_refinery_llm-script-include'],
    name: 'RefineryLLM',
    script: Now.include('./refineryLLM.server.js'),
    apiName: 'x_snc_kb_refinery.RefineryLLM',
    clientCallable: false,
    mobileCallable: false,
    sandboxCallable: false,
    active: true,
})
