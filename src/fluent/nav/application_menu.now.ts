import { ApplicationMenu, Record } from '@servicenow/sdk/core'
import { userRole } from '../roles/user.now'

// UI16 / Next Experience application menu + modules for the pipeline
// tables, so an admin with x_snc_kb_refinery.user can inspect/manage raw
// records via the native list view, separate from the app's own AIUX pages.
// `sys_app_module` has no dedicated Fluent factory (see `ApplicationMenu.d.ts`
// vs. `sys_app_module.now.d.ts` in @servicenow/sdk-core) -- modules go
// through the generic `Record()` API instead.
export const kbRefineryMenu = ApplicationMenu({
    $id: Now.ID['x_snc_kb_refinery-application-menu'],
    title: 'Knowledge Refinery',
    name: 'Knowledge Refinery',
    hint: 'Knowledge Refinery pipeline data',
    roles: [userRole],
    category: '',
})

Record({
    $id: Now.ID['x_snc_kb_refinery-module-analysis'],
    table: 'sys_app_module',
    data: {
        title: 'Analysis',
        hint: 'One row per source KB article and its current pipeline state',
        application: kbRefineryMenu,
        name: 'x_snc_kb_refinery_analysis',
        link_type: 'LIST',
        order: 100,
        active: false,
        override_menu_roles: false,
        require_confirmation: false,
        sys_domain: 'global',
        sys_domain_path: '/',
        uncancelable: false,
    },
})

Record({
    $id: Now.ID['x_snc_kb_refinery-module-snapshot'],
    table: 'sys_app_module',
    data: {
        title: 'Content Snapshot',
        hint: 'Append-only raw/converted/enriched content history per article',
        application: kbRefineryMenu,
        name: 'x_snc_kb_refinery_snapshot',
        link_type: 'LIST',
        order: 200,
        active: false,
        override_menu_roles: false,
        require_confirmation: false,
        sys_domain: 'global',
        sys_domain_path: '/',
        uncancelable: false,
    },
})

Record({
    $id: Now.ID['x_snc_kb_refinery-module-finding'],
    table: 'sys_app_module',
    data: {
        title: 'Finding',
        hint: 'Quality issues found on an article',
        application: kbRefineryMenu,
        name: 'x_snc_kb_refinery_finding',
        link_type: 'LIST',
        order: 300,
        active: false,
        override_menu_roles: false,
        require_confirmation: false,
        sys_domain: 'global',
        sys_domain_path: '/',
        uncancelable: false,
    },
})

Record({
    $id: Now.ID['x_snc_kb_refinery-module-evidence'],
    table: 'sys_app_module',
    data: {
        title: 'Evidence',
        hint: 'Findings linked to the incidents that support them',
        application: kbRefineryMenu,
        name: 'x_snc_kb_refinery_evidence',
        link_type: 'LIST',
        order: 400,
        active: false,
        override_menu_roles: false,
        require_confirmation: false,
        sys_domain: 'global',
        sys_domain_path: '/',
        uncancelable: false,
    },
})

Record({
    $id: Now.ID['x_snc_kb_refinery-module-product'],
    table: 'sys_app_module',
    data: {
        title: 'Product Index',
        hint: 'Canonical product names mentioned across articles',
        application: kbRefineryMenu,
        name: 'x_snc_kb_refinery_product',
        link_type: 'LIST',
        order: 500,
        active: false,
        override_menu_roles: false,
        require_confirmation: false,
        sys_domain: 'global',
        sys_domain_path: '/',
        uncancelable: false,
    },
})

Record({
    $id: Now.ID['x_snc_kb_refinery-module-mention'],
    table: 'sys_app_module',
    data: {
        title: 'Product Mention',
        hint: 'Which articles mention which products, and how often',
        application: kbRefineryMenu,
        name: 'x_snc_kb_refinery_mention',
        link_type: 'LIST',
        order: 600,
        active: false,
        override_menu_roles: false,
        require_confirmation: false,
        sys_domain: 'global',
        sys_domain_path: '/',
        uncancelable: false,
    },
})

Record({
    $id: Now.ID['x_snc_kb_refinery-module-job'],
    table: 'sys_app_module',
    data: {
        title: 'Analysis Job',
        hint: 'Pipeline run history and in-progress status',
        application: kbRefineryMenu,
        name: 'x_snc_kb_refinery_job',
        link_type: 'LIST',
        order: 700,
        active: false,
        override_menu_roles: false,
        require_confirmation: false,
        sys_domain: 'global',
        sys_domain_path: '/',
        uncancelable: false,
    },
})

Record({
    $id: Now.ID['x_snc_kb_refinery-module-prompt-template'],
    table: 'sys_app_module',
    data: {
        title: 'Prompt Template',
        hint: 'Read-only LLM prompt templates used by the pipeline',
        application: kbRefineryMenu,
        name: 'x_snc_kb_refinery_prompt_template',
        link_type: 'LIST',
        order: 800,
        active: false,
        override_menu_roles: false,
        require_confirmation: false,
        sys_domain: 'global',
        sys_domain_path: '/',
        uncancelable: false,
    },
})

Record({
    $id: Now.ID['x_snc_kb_refinery-module-eval-question'],
    table: 'sys_app_module',
    data: {
        title: 'Eval Question',
        hint: 'Imported eval set of real user queries and cited KB articles',
        application: kbRefineryMenu,
        name: 'x_snc_kb_refinery_eval_question',
        link_type: 'LIST',
        order: 900,
        active: false,
        override_menu_roles: false,
        require_confirmation: false,
        sys_domain: 'global',
        sys_domain_path: '/',
        uncancelable: false,
    },
})
