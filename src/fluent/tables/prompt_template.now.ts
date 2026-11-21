import '@servicenow/sdk/global'
import { Table, StringColumn } from '@servicenow/sdk/core'

// Read-only reference table for the pipeline's LLM prompts -- data instead of
// hardcoded strings in script, mirroring AI Group Chat's own
// x_snc_ai_grp_chat_prompt_template table. Rendered via
// RefineryPromptTemplate.render(name, vars), a {{var}} substitution over
// `template` (see src/fluent/script-includes/refineryPromptTemplate.now.ts).
export const x_snc_kb_refinery_prompt_template = Table({
    extends: 'sys_metadata',
    actions: {
        read: true,
        update: false,
        delete: false,
        create: false,
    },
    allowClientScripts: false,
    allowNewFields: false,
    allowUiActions: false,
    allowWebServiceAccess: true,
    attributes: {
        enforce_dot_walk_cross_scope_access: true,
    },
    display: 'name',
    label: 'Prompt Template',
    name: 'x_snc_kb_refinery_prompt_template',
    schema: {
        name: StringColumn({
            isFullUTF8: true,
            maxLength: 255,
            mandatory: true,
        }),
        template: StringColumn({
            isFullUTF8: true,
            label: 'Template',
            maxLength: 16000,
        }),
    },
})
