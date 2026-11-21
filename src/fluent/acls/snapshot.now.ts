import { Acl } from '@servicenow/sdk/core'
import { userRole } from '../roles/user.now'

Acl({
    $id: Now.ID['x_snc_kb_refinery_snapshot-create-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_snapshot',
    operation: 'create',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_snapshot-read-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_snapshot',
    operation: 'read',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_snapshot-write-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_snapshot',
    operation: 'write',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_snapshot-delete-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_snapshot',
    operation: 'delete',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})
