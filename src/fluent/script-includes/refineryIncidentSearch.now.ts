import { ScriptInclude } from '@servicenow/sdk/core'

export const refineryIncidentSearch = ScriptInclude({
    $id: Now.ID['x_snc_kb_refinery_incident_search-script-include'],
    name: 'RefineryIncidentSearch',
    script: Now.include('./refineryIncidentSearch.server.js'),
    apiName: 'x_snc_kb_refinery.RefineryIncidentSearch',
    clientCallable: false,
    mobileCallable: false,
    sandboxCallable: false,
    active: true,
})
