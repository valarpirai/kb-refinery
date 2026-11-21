import { ScriptInclude } from '@servicenow/sdk/core'

// Shared KB-article content extraction, dispatched by sys_class_name.
// See refineryKbContent.server.js's own header comment for the full
// class-dispatch shape. Extracted out of RefineryEvalScorer so every
// caller shares one implementation instead of each re-implementing (or
// omitting) subclass handling on its own.
export const refineryKbContent = ScriptInclude({
    $id: Now.ID['x_snc_kb_refinery_kb_content-script-include'],
    name: 'RefineryKbContent',
    script: Now.include('./refineryKbContent.server.js'),
    apiName: 'x_snc_kb_refinery.RefineryKbContent',
    clientCallable: false,
    mobileCallable: false,
    sandboxCallable: false,
    active: true,
})
