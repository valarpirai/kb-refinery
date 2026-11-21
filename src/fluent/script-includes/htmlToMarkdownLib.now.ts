import { ScriptInclude } from '@servicenow/sdk/core'

export const htmlToMarkdownLib = ScriptInclude({
    $id: Now.ID['x_snc_kb_refinery_html_to_markdown_lib-script-include'],
    name: 'HTMLToMarkdownLib',
    script: Now.include('./htmlToMarkdownLib.server.js'),
    apiName: 'x_snc_kb_refinery.HTMLToMarkdownLib',
    clientCallable: false,
    mobileCallable: false,
    sandboxCallable: false,
    active: true,
})
