import { Role } from '@servicenow/sdk/core'

// Baseline role for the Knowledge Refinery pipeline tables (see docs/security.md).
// No $id: Role identity is derived from `name`, not a deprecated explicit key.
export const userRole = Role({
    name: 'x_snc_kb_refinery.user',
    description:
        'Create/read/write/delete access to Knowledge Refinery pipeline data: analysis, snapshots, findings, evidence, products, mentions, and jobs.',
    $override: {
        u_restrict_impersonate: 'false',
    },
})
