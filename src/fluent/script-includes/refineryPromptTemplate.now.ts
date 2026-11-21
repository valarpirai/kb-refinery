import { ScriptInclude } from '@servicenow/sdk/core'

export const refineryPromptTemplate = ScriptInclude({
    $id: Now.ID['x_snc_kb_refinery_prompt_template_lib-script-include'],
    name: 'RefineryPromptTemplate',
    script: Now.include('./refineryPromptTemplate.server.js'),
    apiName: 'x_snc_kb_refinery.RefineryPromptTemplate',
    clientCallable: false,
    mobileCallable: false,
    sandboxCallable: false,
    active: true,
})
