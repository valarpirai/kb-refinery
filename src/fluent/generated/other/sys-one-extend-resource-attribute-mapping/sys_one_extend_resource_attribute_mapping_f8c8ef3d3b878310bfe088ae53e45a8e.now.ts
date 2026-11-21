import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['f8c8ef3d3b878310bfe088ae53e45a8e'],
    table: 'sys_one_extend_resource_attribute_mapping',
    data: {
        attribute_value_script: `(function execute(currentInputs, context) {
 return new global.OneExtendEvaluationServiceUtil().getSkillContext(currentInputs); 
})(currentInputs, context);`,
        attribute_value_type: 'script',
        resource_attribute_name: '667113fa7f82d21071cab6257d8665d7',
        resource_mapping: 'a4c8ef3d3b878310bfe088ae53e45a6f',
        sys_domain: 'global',
        sys_domain_path: '/',
        truncate: 'false',
        type: 'input',
    },
})
