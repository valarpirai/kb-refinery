import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['68c8ef3d3b878310bfe088ae53e45a25'],
    table: 'sys_one_extend_resource_attribute_mapping',
    data: {
        attribute_value_script: `(function execute(currentInputs, context) {
 return new global.OneExtendEvaluationServiceUtil().getSkillContext(currentInputs); 
})(currentInputs, context);`,
        attribute_value_type: 'script',
        resource_attribute_name: 'b4f0d77a7f82d21071cab6257d8665f8',
        resource_mapping: '6cc8af3d3b878310bfe088ae53e45ae3',
        sys_domain: 'global',
        sys_domain_path: '/',
        truncate: 'false',
        type: 'input',
    },
})
