import { Acl } from '@servicenow/sdk/core'
import { userRole } from '../roles/user.now'

Acl({
    $id: Now.ID['x_snc_kb_refinery_analysis-create-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_analysis',
    operation: 'create',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_analysis-read-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_analysis',
    operation: 'read',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_analysis-write-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_analysis',
    operation: 'write',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_analysis-delete-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_analysis',
    operation: 'delete',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})
