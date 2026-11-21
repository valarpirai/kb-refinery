import { ScriptInclude } from '@servicenow/sdk/core'

export const refineryOrchestrator = ScriptInclude({
    $id: Now.ID['x_snc_kb_refinery_orchestrator-script-include'],
    name: 'RefineryOrchestrator',
    script: Now.include('./refineryOrchestrator.server.js'),
    apiName: 'x_snc_kb_refinery.RefineryOrchestrator',
    clientCallable: false,
    mobileCallable: false,
    sandboxCallable: false,
    active: true,
})
