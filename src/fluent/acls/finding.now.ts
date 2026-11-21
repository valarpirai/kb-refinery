import { Acl } from '@servicenow/sdk/core'
import { userRole } from '../roles/user.now'

Acl({
    $id: Now.ID['x_snc_kb_refinery_finding-create-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_finding',
    operation: 'create',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_finding-read-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_finding',
    operation: 'read',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_finding-write-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_finding',
    operation: 'write',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_finding-delete-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_finding',
    operation: 'delete',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})
