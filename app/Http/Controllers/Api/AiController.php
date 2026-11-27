<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\AiException;
use App\Http\Controllers\Controller;
use App\Models\AiKnowledgeDocument;
use App\Models\AiUsageLog;
use App\Models\Conversation;
use App\Services\AiConfigService;
use App\Services\AiKnowledgeService;
use App\Services\AiProviderService;
use App\Services\AiService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class AiController extends Controller
{
    public function __construct(
        private AiConfigService $configs,
        private AiProviderService $providers,
        private AiKnowledgeService $knowledge,
        private AiService $ai,
    ) {}

    public function config(): JsonResponse
    {
        return response()->json($this->configs->publicConfig());
    }

    public function saveConfig(Request $request): JsonResponse
    {
        $data = $request->validate([
            'provider' => ['required', 'in:openai,anthropic,openai_compatible'],
            'model' => ['required', 'string', 'max:120'],
            'base_url' => ['nullable', 'string', 'max:255'],
            'api_key' => ['required', 'string'],
            'embeddings_api_key' => ['nullable', 'string'],
            'system_prompt' => ['nullable', 'string'],
            'is_active' => ['nullable', 'boolean'],
            'auto_reply_enabled' => ['sometimes', 'boolean'],
            'auto_reply_max_per_conversation' => ['sometimes', 'integer', 'min:1', 'max:50'],
            'handoff_agent_id' => ['nullable', 'integer', function ($attribute, $value, $fail) {
                if (! app(\App\Auth\Access::class)->canBeAssigned(\App\Models\User::find($value))) {
                    $fail('Select an eligible active assignee.');
                }
            }],
        ]);

        if ($data['api_key'] === AiConfigService::MASK && ! $this->configs->current()?->api_key) {
            throw ValidationException::withMessages(['api_key' => 'Enter an API key before saving.']);
        }

        $config = $this->configs->save($data, $request->user()->id);

        return response()->json($this->configs->publicConfig() + ['saved' => $config->id]);
    }

    public function deleteConfig(): JsonResponse
    {
        $this->configs->delete();

        return response()->json(['ok' => true]);
    }

    public function testConfig(Request $request): JsonResponse
    {
        $data = $request->validate([
            'provider' => ['required', 'in:openai,anthropic,openai_compatible'],
            'model' => ['required', 'string', 'max:120'],
            'base_url' => ['nullable', 'string', 'max:255'],
            'api_key' => ['required', 'string'],
        ]);

        $settings = $this->configs->settings();
        if ($data['api_key'] === AiConfigService::MASK) {
            $data['api_key'] = $settings['api_key'] ?? '';
        }
        $settings = array_merge($settings, $data);

        try {
            $result = $this->providers->generate($settings, [
                ['role' => 'user', 'content' => 'Reply with exactly: OK'],
            ], ['max_tokens' => 16]);

            return response()->json(['ok' => true, 'reply' => $result['content'], 'model' => $result['model']]);
        } catch (AiException $exception) {
            return $this->aiError($exception);
        }
    }

    public function playground(Request $request): JsonResponse
    {
        $data = $request->validate([
            'messages' => ['required', 'array', 'min:1', 'max:20'],
            'messages.*.role' => ['required', 'in:user,assistant'],
            'messages.*.content' => ['required', 'string', 'max:4000'],
        ]);

        try {
            return response()->json($this->ai->playground($data['messages'], $request->user()->id));
        } catch (AiException $exception) {
            return $this->aiError($exception);
        }
    }

    public function draft(Request $request): JsonResponse
    {
        $data = $request->validate([
            'conversation_id' => ['required', 'exists:conversations,id'],
        ]);

        $conversation = Conversation::findOrFail($data['conversation_id']);
        app(\App\Auth\Access::class)->authorizeConversation($request->user(), $conversation);

        try {
            return response()->json($this->ai->draft(
                $conversation,
                $request->user()->id,
            ));
        } catch (AiException $exception) {
            return $this->aiError($exception);
        }
    }

    public function usage(Request $request): JsonResponse
    {
        $days = min(max($request->integer('days', 30), 1), 90);
        $timezone = $request->string('tz')->toString();
        if (! in_array($timezone, timezone_identifiers_list(), true)) {
            $timezone = config('app.timezone', 'UTC');
        }

        $start = Carbon::now($timezone)->subDays($days - 1)->startOfDay()->utc();
        $logs = AiUsageLog::query()
            ->where('created_at', '>=', $start)
            ->orderBy('id')
            ->limit(10000)
            ->get();

        $daily = [];
        $byModel = [];

        foreach ($logs as $log) {
            $day = $log->created_at->copy()->setTimezone($timezone)->toDateString();
            $daily[$day] ??= ['date' => $day, 'tokens' => 0, 'calls' => 0];
            $daily[$day]['tokens'] += $log->total_tokens;
            $daily[$day]['calls']++;

            $model = $log->model ?: 'unknown';
            $byModel[$model] ??= ['model' => $model, 'tokens' => 0, 'calls' => 0];
            $byModel[$model]['tokens'] += $log->total_tokens;
            $byModel[$model]['calls']++;
        }

        return response()->json([
            'days' => $days,
            'total_tokens' => $logs->sum('total_tokens'),
            'llm_calls' => $logs->count(),
            'auto_reply' => $logs->where('mode', 'auto_reply')->count(),
            'drafts' => $logs->where('mode', 'draft')->count(),
            'daily' => array_values($daily),
            'by_model' => array_values($byModel),
            'truncated' => $logs->count() >= 10000,
        ]);
    }

    public function updateAutoreply(Request $request, Conversation $conversation): JsonResponse
    {
        $data = $request->validate([
            'paused' => ['required', 'boolean'],
            'assign_to_me' => ['sometimes', 'boolean'],
        ]);
        $paused = (bool) $data['paused'];
        $updates = ['ai_autoreply_disabled' => $paused];

        $access = app(\App\Auth\Access::class);
        if ($paused && ($data['assign_to_me'] ?? false)) {
            abort_unless($access->can($request->user(), 'conversations.assign')
                && $access->canBeAssigned($request->user()), 403);
            $updates['assigned_agent_id'] = $request->user()->id;
        } elseif (! $paused) {
            if ($conversation->assigned_agent_id !== null) {
                abort_unless($access->can($request->user(), 'conversations.assign'), 403);
                $updates['assigned_agent_id'] = null;
            }
            $updates['ai_reply_count'] = 0;
            $updates['ai_handoff_summary'] = null;
        }

        $conversation->update($updates);

        app(\App\Services\RealtimeBroadcaster::class)->conversationUpdated($conversation);
        return response()->json($access->redactConversation(
            $conversation->load(['contact.tags', 'assignedAgent:id,name,avatar_url']), $request->user()
        ));
    }

    public function knowledge(): JsonResponse
    {
        return response()->json($this->knowledge->documents());
    }

    public function storeKnowledge(Request $request): JsonResponse
    {
        $data = $this->knowledgeData($request);

        return response()->json($this->knowledge->create($data), 201);
    }

    public function updateKnowledge(Request $request, AiKnowledgeDocument $document): JsonResponse
    {
        return response()->json($this->knowledge->update($document, $this->knowledgeData($request)));
    }

    public function deleteKnowledge(AiKnowledgeDocument $document): JsonResponse
    {
        $this->knowledge->delete($document);

        return response()->json(['ok' => true]);
    }

    public function reindexKnowledge(): JsonResponse
    {
        $config = $this->configs->current();
        if (! $config) {
            return $this->aiError(new AiException('Configure AI before indexing the knowledge base.', 422, 'ai_not_configured'));
        }

        $count = $this->knowledge->reindex($this->configs->settings($config));

        return response()->json(['chunks' => $count]);
    }

    private function knowledgeData(Request $request): array
    {
        return $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'content' => ['required', 'string'],
            'source' => ['nullable', 'string', 'max:255'],
            'is_active' => ['nullable', 'boolean'],
        ]);
    }

    private function aiError(AiException $exception): JsonResponse
    {
        return response()->json([
            'message' => $exception->getMessage(),
            'code' => $exception->key ?: 'ai_provider_error',
        ], $exception->status);
    }
}
