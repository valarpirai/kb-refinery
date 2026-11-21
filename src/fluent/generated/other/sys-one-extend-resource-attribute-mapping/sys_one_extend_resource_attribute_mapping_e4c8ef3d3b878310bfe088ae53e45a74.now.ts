import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['e4c8ef3d3b878310bfe088ae53e45a74'],
    table: 'sys_one_extend_resource_attribute_mapping',
    data: {
        attribute_value_script: `(function execute(currentInputs, context) {
 return new global.OneExtendEvaluationServiceUtil().getPredictedResponse(currentInputs); 
})(currentInputs, context);`,
        attribute_value_type: 'script',
        resource_attribute_name: '290196427f0202105bc49fbefc866554',
        resource_mapping: 'a4c8ef3d3b878310bfe088ae53e45a6f',
        sys_domain: 'global',
        sys_domain_path: '/',
        truncate: 'false',
        type: 'input',
    },
})
