import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['e2b8af393b8f83106479ff7e53e45abf'],
    table: 'sys_one_extend_eval_attribute',
    data: {
        advanced: 'false',
        capability: 'c2b82f393b8f83106479ff7e53e45aa0',
        capability_attribute: '1eb8af393b8f83106479ff7e53e45abb',
        data_type: 'string',
        label: 'Golden Response',
        name: 'response',
        sys_domain: 'global',
        sys_domain_path: '/',
        template_script: `(function getValue(response) {
   // response would give the response from capability 
})(response);`,
    },
})
