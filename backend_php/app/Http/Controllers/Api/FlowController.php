<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Flow;
use App\Models\FlowRun;
use App\Services\FlowService;
use App\Services\FlowValidator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class FlowController extends Controller
{
    public function __construct(
        private FlowService $flows,
        private FlowValidator $validator,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json(Flow::query()->latest()->paginate(50));
    }

    public function templates(): JsonResponse
    {
        return response()->json($this->flows->templates());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required_without:template_slug', 'string', 'max:200'],
            'description' => ['nullable', 'string'],
            'trigger_type' => ['sometimes', Rule::in(FlowValidator::TRIGGERS)],
            'trigger_config' => ['nullable', 'array'],
            'template_slug' => ['nullable', 'string'],
        ]);

        return response()->json($this->flows->graph($this->flows->create($data, $request->user()->id)), 201);
    }

    public function show(Flow $flow): JsonResponse
    {
        return response()->json($this->flows->graph($flow));
    }

    public function update(Request $request, Flow $flow): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:200'],
            'description' => ['nullable', 'string'],
            'trigger_type' => ['sometimes', Rule::in(FlowValidator::TRIGGERS)],
            'trigger_config' => ['nullable', 'array'],
            'entry_node_id' => ['nullable', 'string', 'max:100'],
            'fallback_policy' => ['nullable', 'array'],
            'nodes' => ['sometimes', 'array'],
            'nodes.*.node_key' => ['required', 'string', 'max:100'],
            'nodes.*.node_type' => ['required', 'string', 'max:100'],
            'nodes.*.config' => ['nullable', 'array'],
            'nodes.*.position_x' => ['nullable', 'integer'],
            'nodes.*.position_y' => ['nullable', 'integer'],
        ]);

        $merged = [
            'name' => $data['name'] ?? $flow->name,
            'trigger_type' => $data['trigger_type'] ?? $flow->trigger_type,
            'trigger_config' => $data['trigger_config'] ?? $flow->trigger_config,
            'entry_node_id' => $data['entry_node_id'] ?? $flow->entry_node_id,
        ];
        $nodes = $data['nodes'] ?? $this->flows->graph($flow)['nodes'];

        if ($flow->status === 'active') {
            $issues = $this->validator->validate($merged, $nodes);
            if ($issues) {
                return response()->json(['message' => 'Fix the highlighted issues before saving.', 'issues' => $issues], 422);
            }
        }

        return response()->json($this->flows->update($flow, $data));
    }

    public function destroy(Flow $flow): JsonResponse
    {
        $flow->delete();

        return response()->json(['ok' => true]);
    }

    public function activate(Request $request, Flow $flow): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in(FlowValidator::STATUSES)],
        ]);
        $graph = $this->flows->graph($flow);

        if ($data['status'] === 'active') {
            $issues = $this->validator->validate($graph['flow']->toArray(), $graph['nodes']);
            if ($issues) {
                return response()->json(['message' => 'Fix the highlighted issues before activating.', 'issues' => $issues], 422);
            }
        }

        return response()->json($this->flows->setStatus($flow, $data['status']));
    }

    public function runs(Flow $flow): JsonResponse
    {
        $runs = FlowRun::query()
            ->where('flow_id', $flow->id)
            ->with(['contact:id,name,phone', 'events' => fn ($query) => $query->latest()->limit(20)])
            ->latest()
            ->limit(50)
            ->get();

        return response()->json(['flow' => $flow, 'runs' => $runs]);
    }
}
