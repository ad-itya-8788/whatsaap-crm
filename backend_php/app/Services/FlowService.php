<?php

namespace App\Services;

use App\Models\Flow;
use App\Models\FlowNode;
use App\Models\FlowRun;
use Illuminate\Support\Facades\DB;

class FlowService
{
    public function templates(): array
    {
        return [
            [
                'slug' => 'welcome_message',
                'name' => 'Welcome message',
                'description' => 'Greet new contacts and collect their interest.',
                'trigger_type' => 'first_inbound_message',
                'trigger_config' => [],
                'entry_node_id' => 'start',
                'nodes' => [
                    ['node_key' => 'start', 'node_type' => 'start', 'config' => ['next_node_key' => 'welcome'], 'position_x' => 0, 'position_y' => 0],
                    ['node_key' => 'welcome', 'node_type' => 'send_message', 'config' => ['text' => 'Hi {{ contact.name }}! Thanks for reaching out to Aayojan. How can we help today?', 'next_node_key' => 'collect'], 'position_x' => 0, 'position_y' => 120],
                    ['node_key' => 'collect', 'node_type' => 'collect_input', 'config' => ['text' => 'Please share a few details and our team will get back to you.', 'next_node_key' => 'end'], 'position_x' => 0, 'position_y' => 240],
                    ['node_key' => 'end', 'node_type' => 'end', 'config' => [], 'position_x' => 0, 'position_y' => 360],
                ],
            ],
            [
                'slug' => 'lead_qualifier',
                'name' => 'Lead qualifier',
                'description' => 'Ask two quick questions before handing off.',
                'trigger_type' => 'keyword',
                'trigger_config' => ['keywords' => ['interested', 'demo', 'pricing']],
                'entry_node_id' => 'start',
                'nodes' => [
                    ['node_key' => 'start', 'node_type' => 'start', 'config' => ['next_node_key' => 'ask_budget'], 'position_x' => 0, 'position_y' => 0],
                    ['node_key' => 'ask_budget', 'node_type' => 'send_buttons', 'config' => ['text' => 'What budget range are you considering?', 'buttons' => [['id' => 'budget_low', 'title' => 'Under ₹5k', 'next_node_key' => 'handoff'], ['id' => 'budget_mid', 'title' => '₹5k–₹20k', 'next_node_key' => 'handoff'], ['id' => 'budget_high', 'title' => '₹20k+', 'next_node_key' => 'handoff']]], 'position_x' => 0, 'position_y' => 120],
                    ['node_key' => 'handoff', 'node_type' => 'handoff', 'config' => [], 'position_x' => 0, 'position_y' => 240],
                    ['node_key' => 'end', 'node_type' => 'end', 'config' => [], 'position_x' => 0, 'position_y' => 360],
                ],
            ],
            [
                'slug' => 'follow_up_reminder',
                'name' => 'Follow-up reminder',
                'description' => 'Send a polite reminder and close the flow.',
                'trigger_type' => 'manual',
                'trigger_config' => [],
                'entry_node_id' => 'start',
                'nodes' => [
                    ['node_key' => 'start', 'node_type' => 'start', 'config' => ['next_node_key' => 'reminder'], 'position_x' => 0, 'position_y' => 0],
                    ['node_key' => 'reminder', 'node_type' => 'send_message', 'config' => ['text' => 'Hi {{ contact.name }}, just checking in. Let me know if you still need anything!', 'next_node_key' => 'end'], 'position_x' => 0, 'position_y' => 120],
                    ['node_key' => 'end', 'node_type' => 'end', 'config' => [], 'position_x' => 0, 'position_y' => 240],
                ],
            ],
        ];
    }

    public function create(array $data, int $userId): Flow
    {
        $template = collect($this->templates())->firstWhere('slug', $data['template_slug'] ?? null);

        return DB::transaction(function () use ($data, $userId, $template) {
            $flow = Flow::create([
                'user_id' => $userId,
                'name' => $template['name'] ?? $data['name'],
                'description' => $template['description'] ?? ($data['description'] ?? null),
                'status' => 'draft',
                'trigger_type' => $template['trigger_type'] ?? ($data['trigger_type'] ?? 'manual'),
                'trigger_config' => $template['trigger_config'] ?? ($data['trigger_config'] ?? []),
                'entry_node_id' => $template['entry_node_id'] ?? null,
                'fallback_policy' => $data['fallback_policy'] ?? [
                    'on_unknown_reply' => 'reprompt',
                    'max_reprompts' => 1,
                    'on_exhaust' => 'handoff',
                    'on_timeout_hours' => 24,
                ],
            ]);

            if ($template) {
                $this->replaceNodes($flow, $template['nodes']);
            }

            return $flow->refresh()->load('nodes');
        });
    }

    public function update(Flow $flow, array $data): Flow
    {
        DB::transaction(function () use ($flow, $data) {
            $flow->update([
                'name' => $data['name'] ?? $flow->name,
                'description' => $data['description'] ?? $flow->description,
                'trigger_type' => $data['trigger_type'] ?? $flow->trigger_type,
                'trigger_config' => $data['trigger_config'] ?? $flow->trigger_config,
                'entry_node_id' => $data['entry_node_id'] ?? $flow->entry_node_id,
                'fallback_policy' => $data['fallback_policy'] ?? $flow->fallback_policy,
            ]);

            if (array_key_exists('nodes', $data)) {
                $this->replaceNodes($flow, $data['nodes']);
            }
        });

        return $flow->refresh()->load('nodes');
    }

    public function setStatus(Flow $flow, string $status): Flow
    {
        $flow->update(['status' => $status]);

        if ($status !== 'active') {
            FlowRun::query()
                ->where('flow_id', $flow->id)
                ->where('status', 'active')
                ->update([
                    'status' => 'cancelled',
                    'end_reason' => $status === 'draft' ? 'flow_draft' : 'flow_archived',
                    'ended_at' => now(),
                ]);
        }

        return $flow->refresh()->load('nodes');
    }

    public function graph(Flow $flow): array
    {
        $flow->load('nodes');

        return [
            'flow' => $flow,
            'nodes' => $flow->nodes
                ->sortBy(['position_y', 'position_x'])
                ->values()
                ->map(fn (FlowNode $node) => [
                    'node_key' => $node->node_key,
                    'node_type' => $node->node_type,
                    'config' => $node->config ?? [],
                    'position_x' => $node->position_x,
                    'position_y' => $node->position_y,
                ])
                ->all(),
        ];
    }

    private function replaceNodes(Flow $flow, array $nodes): void
    {
        $keys = [];

        foreach ($nodes as $node) {
            $key = (string) ($node['node_key'] ?? '');
            if ($key === '') {
                continue;
            }
            $keys[] = $key;
            FlowNode::updateOrCreate(
                ['flow_id' => $flow->id, 'node_key' => $key],
                [
                    'node_type' => $node['node_type'] ?? 'send_message',
                    'config' => $node['config'] ?? [],
                    'position_x' => $node['position_x'] ?? 0,
                    'position_y' => $node['position_y'] ?? 0,
                ],
            );
        }

        $query = FlowNode::where('flow_id', $flow->id);
        if ($keys) {
            $query->whereNotIn('node_key', $keys);
        }
        $query->delete();
    }
}
