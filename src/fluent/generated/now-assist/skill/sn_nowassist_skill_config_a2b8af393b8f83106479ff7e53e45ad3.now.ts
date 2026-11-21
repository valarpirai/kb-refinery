import { NowAssistSkillConfig } from '@servicenow/sdk/core'

NowAssistSkillConfig(
    {
        $id: Now.ID['c2b82f393b8f83106479ff7e53e45aa0'],
        name: 'Knowledge Refinery',
        shortDescription: '',
        description: '',
        inputs: [
            {
                $id: Now.ID['5cf9a3bd3b8f83106479ff7e53e45a02'],
                name: 'prompt',
                description: '',
                mandatory: false,
                dataType: 'string',
                truncate: false,
                testValues: '',
            },
            {
                $id: Now.ID['f5d2abc23b838310bfe088ae53e45a2e'],
                name: 'model',
                description: '',
                mandatory: false,
                dataType: 'string',
                truncate: false,
                testValues: '',
            },
        ],
        outputs: [
            {
                $id: Now.ID['1eb8af393b8f83106479ff7e53e45abb'],
                name: 'response',
                dataType: 'string',
            },
            {
                $id: Now.ID['96b8af393b8f83106479ff7e53e45ab8'],
                name: 'provider',
                dataType: 'string',
            },
            {
                $id: Now.ID['5ab8af393b8f83106479ff7e53e45aa8'],
                name: 'errorcode',
                dataType: 'string',
            },
            {
                $id: Now.ID['62b8af393b8f83106479ff7e53e45ac3'],
                name: 'status',
                dataType: 'string',
            },
            {
                $id: Now.ID['96b8af393b8f83106479ff7e53e45aa3'],
                name: 'error',
                dataType: 'string',
            },
        ],
        state: 'published',
        securityControls: {
            userAccess: {
                type: 'roles',
                $id: Now.ID['26b8af393b8f83106479ff7e53e45ae5'],
                roles: ['x_snc_kb_refinery.user'],
            },
            roleMap: ['x_snc_kb_refinery.user'],
        },
    },
    {
        providers: [
            {
                provider: 'AWS Claude - Amazon Bedrock Chat Completions',
                providerAPI: {
                    type: 'sys_hub_flow',
                    id: '52f46aeb9f2c5210da502fca9a0a1cda',
                },
                prompts: [
                    {
                        name: 'Knowledge Refinery Opus',
                        versions: [
                            {
                                $id: Now.ID['1c232b063b838310bfe088ae53e45a63'],
                                model: 'claude-opus-4-8',
                                temperature: 0.2,
                                maxTokens: 90000,
                                prompt: (p) => `${p.input.prompt}`,
                                promptState: 'published',
                                filterCondition: {
                                    model: 'opus',
                                },
                            },
                        ],
                    },
                    {
                        name: 'Knowledge Refinery Sonnet',
                        versions: [
                            {
                                $id: Now.ID['96b8af393b8f83106479ff7e53e45a72'],
                                model: 'claude-sonnet-4-6',
                                temperature: 0.2,
                                maxTokens: 90000,
                                prompt: (p) => `${p.input.prompt}`,
                                promptState: 'published',
                                filterCondition: {
                                    model: 'sonnet',
                                },
                            },
                        ],
                    },
                ],
                defaultPrompt: 'Knowledge Refinery Opus',
                defaultPromptVersion: 1,
            },
        ],
    }
)
