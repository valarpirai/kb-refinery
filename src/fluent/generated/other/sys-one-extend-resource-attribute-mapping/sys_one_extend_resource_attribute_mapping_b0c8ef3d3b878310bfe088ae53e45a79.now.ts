import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['b0c8ef3d3b878310bfe088ae53e45a79'],
    table: 'sys_one_extend_resource_attribute_mapping',
    data: {
        attribute_value_script: `(function execute(currentInputs, context) {
 return new global.OneExtendEvaluationServiceUtil().getGroundedPrompt(currentInputs); 
})(currentInputs, context);`,
        attribute_value_type: 'script',
        resource_attribute_name: '2de4d2467f0202105bc49fbefc866578',
        resource_mapping: 'a4c8ef3d3b878310bfe088ae53e45a6f',
        sys_domain: 'global',
        sys_domain_path: '/',
        truncate: 'false',
        type: 'input',
    },
})
