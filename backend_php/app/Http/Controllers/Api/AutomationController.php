<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Automation;
use App\Models\CustomField;
use App\Models\MessageTemplate;
use App\Models\Tag;
use App\Models\User;
use App\Services\AutomationEngine;
use App\Services\AutomationService;
use App\Services\AutomationValidator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AutomationController extends Controller
{
    public function __construct(
        private AutomationService $automations,
        private AutomationEngine $engine,
        private AutomationValidator $validator,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json(
            Automation::query()->withCount('logs')->latest()->paginate(50)
        );
    }

    public function options(): JsonResponse
    {
        return response()->json([
            'triggers' => AutomationValidator::TRIGGERS,
            'steps' => AutomationValidator::STEPS,
            'tags' => Tag::query()->orderBy('name')->get(['id', 'name', 'color']),
            'agents' => User::query()->where('is_active', true)->orderBy('name')->get(['id', 'name', 'role']),
            'fields' => CustomField::query()->where('is_active', true)->orderBy('label')->get(['id', 'name', 'label', 'type']),
            'templates' => MessageTemplate::query()
                ->where(function ($query) {
                    $query->where('approval_status', 'approved')->orWhere('status', 'approved');
                })
                ->orderBy('name')
                ->get(['id', 'name', 'language']),
            'timezones' => timezone_identifiers_list(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateAutomation($request);
        $issues = $this->validator->validate($data, $data['steps'] ?? []);
        if ($issues && ! empty($data['is_active'])) {
            return response()->json(['message' => 'Fix the highlighted issues before activating.', 'issues' => $issues], 422);
        }

        $automation = $this->automations->create($data, $request->user()->id);

        return response()->json($this->automations->builder($automation), 201);
    }

    public function show(Automation $automation): JsonResponse
    {
        return response()->json($this->automations->builder($automation));
    }

    public function update(Request $request, Automation $automation): JsonResponse
    {
        $data = $this->validateAutomation($request);
        $isActive = array_key_exists('is_active', $data)
            ? (bool) $data['is_active']
            : (bool) $automation->is_active;
        $data['is_active'] = $isActive;
        $steps = array_key_exists('steps', $data)
            ? $data['steps']
            : $this->automations->builder($automation)['steps'];
        $issues = $this->validator->validate($data, $steps);
        if ($issues && $isActive) {
            return response()->json(['message' => 'Fix the highlighted issues before activating.', 'issues' => $issues], 422);
        }

        if (! $isActive) {
            $this->engine->expireForAutomation($automation);
        }

        return response()->json($this->automations->update($automation, $data));
    }

    public function destroy(Automation $automation): JsonResponse
    {
        $this->engine->expireForAutomation($automation);
        $automation->delete();

        return response()->json(['ok' => true]);
    }

    public function duplicate(Automation $automation, Request $request): JsonResponse
    {
        $copy = $this->automations->duplicate($automation, $request->user()->id);

        return response()->json($this->automations->builder($copy), 201);
    }

    public function logs(Automation $automation): JsonResponse
    {
        return response()->json($automation->logs()->with('contact:id,name,phone')->paginate(50));
    }

    public function test(Request $request, Automation $automation): JsonResponse
    {
        $data = $request->validate([
            'contact_id' => ['required', 'exists:contacts,id'],
            'conversation_id' => ['nullable', 'exists:conversations,id'],
            'text' => ['nullable', 'string', 'max:4096'],
        ]);
        $conversationId = $data['conversation_id'] ?: \App\Models\Conversation::query()
            ->where('contact_id', $data['contact_id'])
            ->value('id');

        $log = $this->engine->run($automation, 'manual_test', [
            'contact_id' => $data['contact_id'],
            'conversation_id' => $conversationId,
            'text' => $data['text'] ?? 'Test automation',
        ]);

        return response()->json($log->load('contact:id,name,phone'));
    }

    private function validateAutomation(Request $request): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:200'],
            'description' => ['nullable', 'string'],
            'trigger_type' => ['required', Rule::in(AutomationValidator::TRIGGERS)],
            'trigger_config' => ['nullable', 'array'],
            'is_active' => ['nullable', 'boolean'],
            'steps' => ['nullable', 'array'],
            'steps.*.id' => ['nullable'],
            'steps.*.step_type' => ['required_with:steps', 'string'],
            'steps.*.config' => ['nullable', 'array'],
            'steps.*.yes' => ['nullable', 'array'],
            'steps.*.no' => ['nullable', 'array'],
        ]);
    }
}
