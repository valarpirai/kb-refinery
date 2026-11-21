import { Acl } from '@servicenow/sdk/core'
import { userRole } from '../roles/user.now'

Acl({
    $id: Now.ID['x_snc_kb_refinery_evidence-create-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_evidence',
    operation: 'create',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_evidence-read-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_evidence',
    operation: 'read',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_evidence-write-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_evidence',
    operation: 'write',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_evidence-delete-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_evidence',
    operation: 'delete',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})
