import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['34c8ef3d3b878310bfe088ae53e45ad7'],
    table: 'sys_one_extend_resource_attribute_mapping',
    data: {
        attribute_value_script: `(function execute(currentInputs, context) {
 return new global.OneExtendEvaluationServiceUtil().getProcessedResponse(currentInputs); 
})(currentInputs, context);`,
        attribute_value_type: 'script',
        resource_attribute_name: '74a9ca6c7f4f02100a03b6257d866522',
        resource_mapping: 'b4c8ef3d3b878310bfe088ae53e45acd',
        sys_domain: 'global',
        sys_domain_path: '/',
        truncate: 'false',
        type: 'input',
    },
})
