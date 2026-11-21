import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['b0c8ef3d3b878310bfe088ae53e45a8a'],
    table: 'sys_one_extend_resource_attribute_mapping',
    data: {
        attribute_value_script: `(function execute(currentInputs, context) {
 return new global.OneExtendEvaluationServiceUtil().getProcessedResponse(currentInputs); 
})(currentInputs, context);`,
        attribute_value_type: 'script',
        resource_attribute_name: '9e4762677f3602100a03b6257d8665cc',
        resource_mapping: 'a4c8ef3d3b878310bfe088ae53e45a6f',
        sys_domain: 'global',
        sys_domain_path: '/',
        truncate: 'false',
        type: 'input',
    },
})
