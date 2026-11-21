import { Acl } from '@servicenow/sdk/core'
import { userRole } from '../roles/user.now'

// Read-only, matching the table's actions: { read: true, update: false,
// delete: false, create: false } -- no create/write/delete ACL needed.
Acl({
    $id: Now.ID['x_snc_kb_refinery_prompt_template-read-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_prompt_template',
    operation: 'read',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})
