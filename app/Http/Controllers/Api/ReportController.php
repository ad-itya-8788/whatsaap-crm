<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class ReportController extends Controller
{
    public function overview(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        $conversations = Conversation::query()
            ->whereBetween('created_at', [$from, $to])->count();

        $messages = Message::query()
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw("COUNT(*) as total,
                COALESCE(SUM(CASE WHEN sender_type = 'customer' THEN 1 ELSE 0 END), 0) as inbound,
                COALESCE(SUM(CASE WHEN sender_type = 'agent' THEN 1 ELSE 0 END), 0) as outbound,
                COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) as delivered,
                COALESCE(SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END), 0) as read_count,
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed")
            ->first();

        $outbound = (int) $messages->outbound;
        $delivered = (int) $messages->delivered;
        $read = (int) $messages->read_count;
        $failed = (int) $messages->failed;

        return response()->json([
            'conversations' => $conversations,
            'messages' => (int) $messages->total,
            'inbound' => (int) $messages->inbound,
            'outbound' => $outbound,
            'delivered' => $delivered,
            'failed' => $failed,
            'delivery_rate' => $outbound > 0 ? round((($delivered + $read) / $outbound) * 100, 1) : 0,
            'failure_rate' => $outbound > 0 ? round(($failed / $outbound) * 100, 1) : 0,
        ]);
    }

    public function agents(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        $assigned = Conversation::query()
            ->whereBetween('created_at', [$from, $to])
            ->whereNotNull('assigned_agent_id')
            ->selectRaw("assigned_agent_id as user_id,
                COUNT(*) as assigned,
                COALESCE(SUM(CASE WHEN status IN ('open', 'pending') THEN 1 ELSE 0 END), 0) as active_conversations,
                COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0) as closed")
            ->groupBy('assigned_agent_id')
            ->get()
            ->keyBy('user_id');

        $replies = Message::query()
            ->whereBetween('created_at', [$from, $to])
            ->where('sender_type', 'agent')
            ->whereNotNull('sender_id')
            ->selectRaw('sender_id as user_id, COUNT(*) as replies')
            ->groupBy('sender_id')
            ->get()
            ->keyBy('user_id');

        $report = User::query()
            ->where('is_active', true)
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(function (User $user) use ($assigned, $replies) {
                $row = $assigned->get($user->id);
                $replyRow = $replies->get($user->id);

                return [
                    'user_id' => $user->id,
                    'name' => $user->name,
                    'assigned' => (int) ($row->assigned ?? 0),
                    'active_conversations' => (int) ($row->active_conversations ?? 0),
                    'closed' => (int) ($row->closed ?? 0),
                    'replies' => (int) ($replyRow->replies ?? 0),
                ];
            });

        return response()->json($report);
    }

    public function trend(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        $conversations = Conversation::query()
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw('DATE(created_at) as day, COUNT(*) as total')
            ->groupByRaw('DATE(created_at)')
            ->pluck('total', 'day');

        $messages = Message::query()
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw("DATE(created_at) as day,
                COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed")
            ->groupByRaw('DATE(created_at)')
            ->get()
            ->keyBy('day');

        $trend = [];
        for ($day = $from->copy()->startOfDay(); $day->lte($to); $day->addDay()) {
            $key = $day->toDateString();
            $messageRow = $messages->get($key);

            $trend[] = [
                'date' => $key,
                'conversations' => (int) ($conversations->get($key) ?? 0),
                'messages' => (int) ($messageRow->total ?? 0),
                'failed' => (int) ($messageRow->failed ?? 0),
            ];
        }

        return response()->json($trend);
    }

    private function range(Request $request): array
    {
        $request->merge([
            'from' => $request->input('from', now()->subDays(29)->toDateString()),
            'to' => $request->input('to', now()->toDateString()),
        ]);

        $validated = $request->validate([
            'from' => ['date_format:Y-m-d'],
            'to' => ['date_format:Y-m-d'],
        ]);

        $from = Carbon::parse($validated['from'])->startOfDay();
        $to = Carbon::parse($validated['to'])->endOfDay();

        if ($from->gt($to)) {
            throw ValidationException::withMessages(['from' => ['The from date must not be after the to date.']]);
        }

        return [$from, $to];
    }
}
