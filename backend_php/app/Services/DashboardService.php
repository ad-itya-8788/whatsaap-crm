<?php

namespace App\Services;

use App\Models\Contact;
use App\Models\Conversation;
use App\Models\CustomField;
use App\Models\Message;
use App\Models\MessageTemplate;
use App\Models\QuickReply;
use App\Models\Tag;
use App\Models\User;
use App\Models\WhatsappConfig;
use Carbon\Carbon;

class DashboardService
{
    public function overview(int $days = 30): array
    {
        [$from, $to, $previousFrom, $previousTo] = $this->range($days);

        $newConversations = Conversation::query()->whereBetween('created_at', [$from, $to])->count();
        $previousConversations = Conversation::query()->whereBetween('created_at', [$previousFrom, $previousTo])->count();

        $resolved = Conversation::query()->whereBetween('closed_at', [$from, $to])->count();
        $previousResolved = Conversation::query()->whereBetween('closed_at', [$previousFrom, $previousTo])->count();

        $outbound = Message::query()
            ->where('sender_type', 'agent')
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw("COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status IN ('delivered', 'read') THEN 1 ELSE 0 END), 0) as delivered,
                COALESCE(SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END), 0) as read_count,
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed")
            ->first();

        $previousOutbound = Message::query()
            ->where('sender_type', 'agent')
            ->whereBetween('created_at', [$previousFrom, $previousTo])
            ->selectRaw("COALESCE(SUM(CASE WHEN status IN ('delivered', 'read') THEN 1 ELSE 0 END), 0) as delivered,
                COALESCE(SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END), 0) as read_count")
            ->first();

        $median = $this->medianReplyMinutes($from, $to);
        $previousMedian = $this->medianReplyMinutes($previousFrom, $previousTo);

        return [
            'days' => $days,
            'generated_at' => now()->toIso8601String(),
            'kpis' => [
                'newConversations' => $newConversations,
                'newConversationsPrevious' => $previousConversations,
                'resolved' => $resolved,
                'resolvedPrevious' => $previousResolved,
                'broadcastDelivered' => (int) $outbound->delivered,
                'broadcastRead' => (int) $outbound->read_count,
                'broadcastDeliveredPrevious' => (int) $previousOutbound->delivered,
                'broadcastReadPrevious' => (int) $previousOutbound->read_count,
                'failedMessages' => (int) $outbound->failed,
            ],
            'replies' => [
                'medianHuman' => $median,
                'medianHumanPrevious' => $previousMedian,
                'team' => $this->team(),
            ],
            'volume' => ['series' => $this->volumeRows($from, $to)],
            'setup' => $this->setup(),
            'replyTargetMinutes' => 15,
            'attention' => $this->attention(),
        ];
    }

    public function attention(int $limit = 10): array
    {
        return Conversation::query()
            ->with(['contact:id,name,phone,consent_status', 'assignedAgent:id,name'])
            ->whereIn('status', ['open', 'pending'])
            ->where(function ($query) {
                $query->where('unread_count', '>', 0)
                    ->orWhere(function ($inner) {
                        $inner->whereNotNull('last_inbound_at')
                            ->where(function ($older) {
                                $older->whereNull('last_reply_at')
                                    ->orWhereColumn('last_inbound_at', '>', 'last_reply_at');
                            });
                    });
            })
            ->orderByDesc('last_message_at')
            ->limit($limit)
            ->get()
            ->map(function (Conversation $conversation) {
                $waiting = $conversation->last_inbound_at
                    ? $conversation->last_inbound_at->diffInMinutes(now())
                    : null;

                return [
                    'id' => $conversation->id,
                    'contact' => $conversation->contact ? [
                        'id' => $conversation->contact->id,
                        'name' => $conversation->contact->name,
                        'phone' => $conversation->contact->phone,
                        'consent_status' => $conversation->contact->consent_status,
                    ] : null,
                    'status' => $conversation->status,
                    'unread' => (int) $conversation->unread_count,
                    'assignee' => $conversation->assignedAgent?->name,
                    'preview' => $conversation->last_message_text,
                    'lastInboundAt' => $conversation->last_inbound_at?->toIso8601String(),
                    'waitingMinutes' => $waiting,
                ];
            })
            ->all();
    }

    public function activity(int $limit = 50): array
    {
        return Message::query()
            ->with(['conversation.contact:id,name,phone'])
            ->latest()
            ->limit($limit)
            ->get()
            ->map(function (Message $message) {
                $contact = $message->conversation?->contact;

                return [
                    'id' => $message->id,
                    'type' => $message->sender_type,
                    'status' => $message->status,
                    'title' => $contact?->name ?: $contact?->phone ?: 'Unknown contact',
                    'preview' => $message->content_text ?: $message->template_name ?: $message->media_type,
                    'conversationId' => $message->conversation_id,
                    'timestamp' => ($message->provider_timestamp ?: $message->created_at)?->toIso8601String(),
                ];
            })
            ->all();
    }

    public function campaigns(int $days = 30): array
    {
        [$from, $to] = $this->range($days);

        $summary = Message::query()
            ->where('sender_type', 'agent')
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw("COUNT(*) as sent,
                COALESCE(SUM(CASE WHEN status IN ('delivered', 'read') THEN 1 ELSE 0 END), 0) as delivered,
                COALESCE(SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END), 0) as read_count,
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed")
            ->first();

        $failures = Message::query()
            ->with(['conversation.contact:id,name,phone'])
            ->where('status', 'failed')
            ->latest()
            ->limit(10)
            ->get()
            ->map(function (Message $message) {
                return [
                    'id' => $message->id,
                    'conversationId' => $message->conversation_id,
                    'contact' => $message->conversation?->contact?->name
                        ?: $message->conversation?->contact?->phone
                        ?: 'Unknown contact',
                    'error' => $message->error_title ?: $message->error_code,
                    'timestamp' => $message->created_at?->toIso8601String(),
                ];
            })
            ->all();

        return [
            'sent' => (int) $summary->sent,
            'delivered' => (int) $summary->delivered,
            'read' => (int) $summary->read_count,
            'failed' => (int) $summary->failed,
            'templates' => MessageTemplate::query()->count(),
            'optedOut' => Contact::query()->where('consent_status', 'opted_out')->count(),
            'failures' => $failures,
        ];
    }

    public function team(): array
    {
        $assigned = Conversation::query()
            ->whereNotNull('assigned_agent_id')
            ->selectRaw("assigned_agent_id as user_id,
                COUNT(*) as assigned,
                COALESCE(SUM(CASE WHEN status IN ('open', 'pending') THEN 1 ELSE 0 END), 0) as active,
                COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0) as closed")
            ->groupBy('assigned_agent_id')
            ->get()
            ->keyBy('user_id');

        $replies = Message::query()
            ->where('sender_type', 'agent')
            ->whereNotNull('sender_id')
            ->selectRaw('sender_id as user_id, COUNT(*) as replies')
            ->groupBy('sender_id')
            ->get()
            ->keyBy('user_id');

        return User::query()
            ->where('is_active', true)
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(function (User $user) use ($assigned, $replies) {
                $row = $assigned->get($user->id);
                $replyRow = $replies->get($user->id);

                return [
                    'id' => $user->id,
                    'name' => $user->name,
                    'assigned' => (int) ($row->assigned ?? 0),
                    'active' => (int) ($row->active ?? 0),
                    'closed' => (int) ($row->closed ?? 0),
                    'replies' => (int) ($replyRow->replies ?? 0),
                ];
            })
            ->all();
    }

    public function setup(): array
    {
        $config = WhatsappConfig::query()->latest('id')->first();

        return [
            'whatsappConnected' => $config !== null
                && in_array($config->status, ['connected', 'active', 'verified'], true),
            'whatsappPhoneNumberId' => $config?->phone_number_id,
            'templates' => MessageTemplate::query()->count(),
            'quickReplies' => QuickReply::query()->count(),
            'contacts' => Contact::query()->count(),
            'tags' => Tag::query()->count(),
            'customFields' => CustomField::query()->count(),
        ];
    }

    public function volume(int $days = 30): array
    {
        [$from, $to] = $this->range($days);

        return $this->volumeRows($from, $to);
    }

    private function volumeRows(Carbon $from, Carbon $to): array
    {
        $conversations = Conversation::query()
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw('DATE(created_at) as day, COUNT(*) as total')
            ->groupByRaw('DATE(created_at)')
            ->pluck('total', 'day');

        $resolved = Conversation::query()
            ->whereBetween('closed_at', [$from, $to])
            ->selectRaw('DATE(closed_at) as day, COUNT(*) as total')
            ->groupByRaw('DATE(closed_at)')
            ->pluck('total', 'day');

        $messages = Message::query()
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw("DATE(created_at) as day,
                COALESCE(SUM(CASE WHEN sender_type = 'customer' THEN 1 ELSE 0 END), 0) as inbound,
                COALESCE(SUM(CASE WHEN sender_type IN ('agent', 'bot') THEN 1 ELSE 0 END), 0) as outbound,
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed")
            ->groupByRaw('DATE(created_at)')
            ->get()
            ->keyBy('day');

        $series = [];
        for ($day = $from->copy()->startOfDay(); $day->lte($to); $day->addDay()) {
            $key = $day->toDateString();
            $row = $messages->get($key);

            $series[] = [
                'date' => $key,
                'newConversations' => (int) ($conversations->get($key) ?? 0),
                'resolved' => (int) ($resolved->get($key) ?? 0),
                'inbound' => (int) ($row->inbound ?? 0),
                'outbound' => (int) ($row->outbound ?? 0),
                'failed' => (int) ($row->failed ?? 0),
            ];
        }

        return $series;
    }

    private function medianReplyMinutes(Carbon $from, Carbon $to): ?float
    {
        $minutes = Conversation::query()
            ->whereNotNull('first_inbound_at')
            ->whereNotNull('last_reply_at')
            ->whereBetween('first_inbound_at', [$from, $to])
            ->whereColumn('last_reply_at', '>=', 'first_inbound_at')
            ->get(['first_inbound_at', 'last_reply_at'])
            ->map(fn (Conversation $conversation) => $conversation->first_inbound_at->diffInMinutes($conversation->last_reply_at))
            ->sort()
            ->values();

        if ($minutes->isEmpty()) {
            return null;
        }

        $middle = intdiv($minutes->count(), 2);

        return $minutes->count() % 2 === 1
            ? (float) $minutes[$middle]
            : round(($minutes[$middle - 1] + $minutes[$middle]) / 2, 1);
    }

    private function range(int $days): array
    {
        $to = now()->endOfDay();
        $from = now()->subDays(max($days, 1) - 1)->startOfDay();
        $previousTo = $from->copy()->subSecond();
        $previousFrom = $from->copy()->subDays(max($days, 1))->startOfDay();

        return [$from, $to, $previousFrom, $previousTo];
    }
}
