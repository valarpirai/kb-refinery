import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['30c8ef3d3b878310bfe088ae53e45ad1'],
    table: 'sys_one_extend_resource_attribute_mapping',
    data: {
        attribute_value_script: `(function execute(currentInputs, context) {
 return new global.OneExtendEvaluationServiceUtil().getGroundedPrompt(currentInputs); 
})(currentInputs, context);`,
        attribute_value_type: 'script',
        resource_attribute_name: 'a4e296a1a3d20210883c25d1d71e616b',
        resource_mapping: 'b4c8ef3d3b878310bfe088ae53e45acd',
        sys_domain: 'global',
        sys_domain_path: '/',
        truncate: 'false',
        type: 'input',
    },
})
