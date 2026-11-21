import { AiAgent } from '@servicenow/sdk/core'

export const kbSearchDemoAgent = AiAgent({
    $id: Now.ID['kb_search_demo_agent'],
    name: 'KB Search Demo Agent',
    description:
        'Demo agent that answers questions by retrieving relevant content via RAG search over a configured AI Search profile.',
    agentRole:
        'You are a demo assistant that answers user questions by retrieving relevant content from a configured knowledge search profile.',
    recordType: 'custom',
    agentDescriptor: 'created_by_build_agent',
    channel: 'nap_and_va',
    processingMessage: 'Searching knowledge sources...',
    postProcessingMessage: "Here's what I found.",

    // Invocation access — who can call this agent at all
    securityAcl: {
        $id: Now.ID['kb_search_demo_agent_acl'],
        type: 'Specific role',
        roles: ['7fcaa702933002009c8579b4f47ffbde'],
    },

    // Dynamic User (Caller-Privilege) — runs as the invoking user,
    // restricted to this role. Required since runAsUser is not set.
    dataAccess: {
        roleMap: ['user'],
    },

    versionDetails: [
        {
            name: 'V1',
            number: 1,
            state: 'published',
            instructions: `Step 1: Use the Knowledge Search tool to retrieve content relevant to the user's question.
Step 2: Present the retrieved information in plain English. Cite each result's title/number where available.
Step 3: If no relevant results are found, tell the user nothing matched and suggest rephrasing the question.`,
        },
    ],

    tools: [
        {
            name: 'Knowledge Search',
            description:
                "Searches the configured AI Search profile for content relevant to the user's question and returns matching documents.",
            // NOT 'rag': despite what the bundled Fluent docs say, the actual
            // sdk-core type defs only accept 'search_retrieval' for the RAG
            // tool shape (RagToolDetails) — 'rag' matches no union member.
            type: 'search_retrieval',
            executionMode: 'autopilot',
            preMessage: 'Searching knowledge sources...',
            postMessage: 'Documents retrieved.',
            inputs: {
                searchType: {
                    type: 'hybrid',
                    semanticIndexes: [
                        // ais_semantic_index_configuration.semantic_field_name for kb_knowledge
                        { value: 'body', label: 'Article Body' },
                    ],
                    documentMatchThreshold: 0,
                },
                searchProfile: {
                    value: 'quick_action_kb_search_profile',
                    label: 'Quick Action - KB Search Profile',
                },
                searchResultsLimit: 5,
                sources: [],
            },
            maxAutoExecutions: 10,
        },
    ],

    // Manual invocation only (Agent Playground / Now Assist Panel) — no trigger for this demo
    triggerConfig: [],
    runAsUser: '',
})
