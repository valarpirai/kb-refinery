import { ScriptInclude } from '@servicenow/sdk/core'

// Ad hoc eval tool -- not called by any pipeline code. Run from Scripts -
// Background, e.g.:
//   var result = RefineryEvalScorer.run();
// See refineryEvalScorer.server.js's own header comment for the full
// options/return shape.
export const refineryEvalScorer = ScriptInclude({
    $id: Now.ID['x_snc_kb_refinery_eval_scorer-script-include'],
    name: 'RefineryEvalScorer',
    script: Now.include('./refineryEvalScorer.server.js'),
    apiName: 'x_snc_kb_refinery.RefineryEvalScorer',
    clientCallable: false,
    mobileCallable: false,
    sandboxCallable: false,
    active: true,
})
