<?php

return [
    'timeout_ms' => (int) env('AI_REQUEST_TIMEOUT_MS', 30000),
    'context_message_limit' => (int) env('AI_CONTEXT_MESSAGE_LIMIT', 20),
    'max_output_tokens' => (int) env('AI_MAX_OUTPUT_TOKENS', 1024),
    'allowed_private_hosts' => array_values(array_filter(array_map('trim', explode(',', env('AI_PROVIDER_ALLOWED_PRIVATE_HOSTS', 'localhost,127.0.0.1,::1'))))),
];
