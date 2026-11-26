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
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class DashboardService
{
    public function overview(int $days = 7): array
    {
        [$from, $to, $previousFrom, $previousTo] = $this->range($days);
        $target = $this->replyTargetMinutes();
        $attention = $this->attentionSummary(10, $target);
        $volume = $this->volumeRows($from, $to);

        $previous = DB::query()
            ->selectSub(Conversation::query()->whereBetween('created_at', [$previousFrom, $previousTo])->selectRaw('COUNT(*)'), 'conversations')
            ->selectSub(Conversation::query()->whereBetween('closed_at', [$previousFrom, $previousTo])->selectRaw('COUNT(*)'), 'resolved')
            ->first();

        $outbound = Message::query()
            ->where('sender_type', 'agent')
            ->whereBetween('created_at', [$previousFrom, $to])
            ->selectRaw("SUM(CASE WHEN created_at >= ? AND status IN ('delivered', 'read') THEN 1 ELSE 0 END) as delivered,
                SUM(CASE WHEN created_at >= ? AND status = 'read' THEN 1 ELSE 0 END) as read_count,
                SUM(CASE WHEN created_at >= ? AND status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN created_at <= ? AND status IN ('delivered', 'read') THEN 1 ELSE 0 END) as previous_delivered,
                SUM(CASE WHEN created_at <= ? AND status = 'read' THEN 1 ELSE 0 END) as previous_read_count",
                [$from, $from, $from, $previousTo, $previousTo])
            ->first();

        $median = $this->medianReplyMinutes($from, $to);
        $previousMedian = $this->medianReplyMinutes($previousFrom, $previousTo);

        return [
            'days' => $days,
            'generated_at' => now()->toIso8601String(),
            'kpis' => [
                'newConversations' => array_sum(array_column($volume, 'newConversations')),
                'newConversationsPrevious' => (int) $previous->conversations,
                'resolved' => array_sum(array_column($volume, 'resolved')),
                'resolvedPrevious' => (int) $previous->resolved,
                'broadcastDelivered' => (int) $outbound->delivered,
                'broadcastRead' => (int) $outbound->read_count,
                'broadcastDeliveredPrevious' => (int) $outbound->previous_delivered,
                'broadcastReadPrevious' => (int) $outbound->previous_read_count,
                'failedMessages' => (int) $outbound->failed,
            ],
            'replies' => [
                'medianHuman' => $median,
                'medianHumanPrevious' => $previousMedian,
                'team' => $this->team(),
            ],
            'volume' => ['series' => $volume],
            'setup' => $this->setup(),
            'replyTargetMinutes' => $target,
            'attention' => $attention,
            'queue' => $attention['queue'],
        ];
    }

    private function attentionSummary(int $limit, int $target): array
    {
        $now = now();
        $waitingQuery = Conversation::query()
            ->whereIn('status', ['open', 'pending'])
            ->whereNotNull('last_inbound_at')
            ->where(function ($inner) {
                $inner->whereNull('last_reply_at')
                    ->orWhereColumn('last_reply_at', '<', 'last_inbound_at');
            });

        $waiting = (clone $waitingQuery)
            ->selectRaw('COUNT(*) as total,
                SUM(CASE WHEN last_inbound_at <= ? THEN 1 ELSE 0 END) as over_target,
                SUM(CASE WHEN last_inbound_at BETWEEN ? AND ? THEN 1 ELSE 0 END) as windows_closing',
                [$now->copy()->subMinutes($target), $now->copy()->subDay(), $now->copy()->subHours(22)])
            ->first();
        $unassigned = Conversation::query()
            ->where('status', 'open')
            ->whereNull('assigned_agent_id')
            ->count();

        $queue = (clone $waitingQuery)
            ->with('contact:id,name,phone')
            ->orderBy('last_inbound_at')
            ->limit($limit)
            ->get(['id', 'contact_id', 'assigned_agent_id', 'last_message_text', 'last_inbound_at', 'unread_count'])
            ->map(function (Conversation $conversation) use ($now) {
                return [
                    'conversationId' => $conversation->id,
                    'contactName' => $conversation->contact?->name,
                    'contactPhone' => $conversation->contact?->phone,
                    'preview' => $conversation->last_message_text,
                    'waitingSince' => $conversation->last_inbound_at?->toIso8601String(),
                    'windowClosesAt' => $conversation->last_inbound_at?->copy()->addDay()->toIso8601String(),
                    'assignedAgentId' => $conversation->assigned_agent_id,
                    'handedOff' => $conversation->assigned_agent_id !== null,
                    'unread' => (int) $conversation->unread_count,
                    'waitingMinutes' => $conversation->last_inbound_at?->diffInMinutes($now),
                ];
            })
            ->all();

        $failedQuery = Message::query()
            ->where('status', 'failed')
            ->where('created_at', '>=', $now->copy()->subDay());
        $failed = (clone $failedQuery)->count();
        $failedMessages = (clone $failedQuery)
            ->with(['conversation:id,contact_id', 'conversation.contact:id,name,phone'])
            ->latest()
            ->limit(10)
            ->get(['id', 'conversation_id', 'content_text', 'template_name', 'error_code', 'error_title', 'created_at'])
            ->map(function (Message $message) {
                $contact = $message->conversation?->contact;

                return [
                    'id' => $message->id,
                    'conversationId' => $message->conversation_id,
                    'contactName' => $contact?->name,
                    'contactPhone' => $contact?->phone,
                    'preview' => $message->content_text ?: $message->template_name,
                    'errorCode' => $message->error_code !== null ? (int) $message->error_code : null,
                    'errorTitle' => $message->error_title,
                    'at' => $message->created_at?->toIso8601String(),
                ];
            })
            ->all();

        return [
            'waiting' => (int) $waiting->total,
            'oldestWaitingSince' => $queue[0]['waitingSince'] ?? null,
            'waitingOverTarget' => (int) $waiting->over_target,
            'unassigned' => $unassigned,
            'windowsClosing' => (int) $waiting->windows_closing,
            'failed' => $failed,
            'failedMessages' => $failedMessages,
            'queue' => $queue,
        ];
    }

    public function activity(int $limit = 50): array
    {
        return Message::query()
            ->with(['conversation:id,contact_id', 'conversation.contact:id,name,phone'])
            ->latest()
            ->limit($limit)
            ->get(['id', 'conversation_id', 'sender_type', 'status', 'content_text', 'template_name', 'media_type', 'provider_timestamp', 'created_at'])
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

    public function campaigns(int $days = 7): array
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
            ->with(['conversation:id,contact_id', 'conversation.contact:id,name,phone'])
            ->where('status', 'failed')
            ->latest()
            ->limit(10)
            ->get(['id', 'conversation_id', 'error_code', 'error_title', 'created_at'])
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
        $config = WhatsappConfig::query()->latest('id')->first(['status', 'phone_number_id']);
        $counts = DB::query()
            ->selectSub(MessageTemplate::query()->selectRaw('COUNT(*)'), 'templates')
            ->selectSub(QuickReply::query()->selectRaw('COUNT(*)'), 'quick_replies')
            ->selectSub(Contact::query()->selectRaw('COUNT(*)'), 'contacts')
            ->selectSub(Tag::query()->selectRaw('COUNT(*)'), 'tags')
            ->selectSub(CustomField::query()->selectRaw('COUNT(*)'), 'custom_fields')
            ->first();

        return [
            'whatsappConnected' => $config !== null
                && in_array($config->status, ['connected', 'active', 'verified'], true),
            'whatsappPhoneNumberId' => $config?->phone_number_id,
            'templates' => (int) $counts->templates,
            'quickReplies' => (int) $counts->quick_replies,
            'contacts' => (int) $counts->contacts,
            'tags' => (int) $counts->tags,
            'customFields' => (int) $counts->custom_fields,
        ];
    }

    public function hourlyVolume(int $days = 7): array
    {
        [$from, $to] = $this->range($days);
        $messages = $this->messageVolumeBy($from, $to, 'SUBSTR(created_at, 12, 2)');
        $hours = [];
        for ($hour = 0; $hour < 24; $hour++) {
            $row = $messages->get(sprintf('%02d', $hour));
            $hours[] = [
                'hour' => $hour,
                'inbound' => (int) ($row->inbound ?? 0),
                'outbound' => (int) ($row->outbound ?? 0),
            ];
        }

        return $hours;
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

        $messages = $this->messageVolumeBy($from, $to, 'DATE(created_at)');

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

    private function messageVolumeBy(Carbon $from, Carbon $to, string $periodExpression): Collection
    {
        return Message::query()
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw("{$periodExpression} as period,
                SUM(CASE WHEN sender_type = 'customer' THEN 1 ELSE 0 END) as inbound,
                SUM(CASE WHEN sender_type IN ('agent', 'bot') THEN 1 ELSE 0 END) as outbound,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed")
            ->groupByRaw($periodExpression)
            ->get()
            ->keyBy('period');
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

    private function replyTargetMinutes(): int
    {
        $value = DB::table('crm_settings')->where('key', 'reply_target_minutes')->value('value');

        if (!is_string($value)) {
            return 15;
        }

        $decoded = json_decode($value, true);
        $minutes = is_int($decoded) || is_float($decoded) ? $decoded : (is_numeric($value) ? $value : 15);

        return max(1, min(1440, (int) $minutes));
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
