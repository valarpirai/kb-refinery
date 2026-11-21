import { Acl } from '@servicenow/sdk/core'
import { userRole } from '../roles/user.now'

Acl({
    $id: Now.ID['x_snc_kb_refinery_mention-create-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_mention',
    operation: 'create',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_mention-read-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_mention',
    operation: 'read',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_mention-write-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_mention',
    operation: 'write',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_mention-delete-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_mention',
    operation: 'delete',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})
