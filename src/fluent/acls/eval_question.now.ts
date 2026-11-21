import { Acl } from '@servicenow/sdk/core'
import { userRole } from '../roles/user.now'

Acl({
    $id: Now.ID['x_snc_kb_refinery_eval_question-create-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_eval_question',
    operation: 'create',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_eval_question-read-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_eval_question',
    operation: 'read',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_eval_question-write-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_eval_question',
    operation: 'write',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})

Acl({
    $id: Now.ID['x_snc_kb_refinery_eval_question-delete-acl'],
    type: 'record',
    table: 'x_snc_kb_refinery_eval_question',
    operation: 'delete',
    decisionType: 'allow',
    roles: [userRole],
    adminOverrides: true,
})
