import { ScriptInclude } from '@servicenow/sdk/core'

export const refineryJsonUtil = ScriptInclude({
    $id: Now.ID['x_snc_kb_refinery_json_util-script-include'],
    name: 'RefineryJsonUtil',
    script: Now.include('./refineryJsonUtil.server.js'),
    apiName: 'x_snc_kb_refinery.RefineryJsonUtil',
    clientCallable: false,
    mobileCallable: false,
    sandboxCallable: false,
    active: true,
})
