<?php

namespace App\Services;

use App\Models\Conversation;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ConversationAssignmentService
{
    public function __construct(private RealtimeBroadcaster $realtime) {}

    public function assign(Conversation $conversation, ?int $assigneeId, User $actor): array
    {
        if ($assigneeId !== null) {
            $assignee = User::query()->findOrFail($assigneeId);
            abort_unless($assignee->is_active && $assignee->hasModuleAccess('inbox'), 422, 'Select an active member with Inbox access.');
        }

        $result = DB::transaction(function () use ($conversation, $assigneeId, $actor) {
            $locked = Conversation::query()->lockForUpdate()->findOrFail($conversation->id);
            $previous = $locked->assigned_agent_id === null ? null : (int) $locked->assigned_agent_id;

            if ($previous === $assigneeId) {
                return [
                    'changed' => false,
                    'conversation' => $locked,
                    'previous' => $previous,
                    'notification' => null,
                ];
            }

            $locked->update(['assigned_agent_id' => $assigneeId]);
            $locked->loadMissing('contact');
            $notification = null;

            if ($assigneeId !== null && $assigneeId !== (int) $actor->id) {
                $exists = Notification::query()
                    ->where('user_id', $assigneeId)
                    ->where('type', 'conversation_assigned')
                    ->where('data->conversation_id', $locked->id)
                    ->exists();

                if (! $exists) {
                    $contact = $locked->contact;
                    $label = $contact?->name ?: $contact?->phone ?: 'a contact';
                    $actorName = $actor->name;
                    $notification = Notification::create([
                        'user_id' => $assigneeId,
                        'type' => 'conversation_assigned',
                        'title' => 'New chat assigned to you',
                        'body' => "{$actorName} assigned you {$label} chat.",
                        'data' => [
                            'conversation_id' => $locked->id,
                            'actor_name' => $actorName,
                            'contact_name' => $label,
                        ],
                    ]);
                }
            }

            Log::info('conversation.assignment_changed', [
                'conversation_id' => $locked->id,
                'from' => $previous,
                'to' => $assigneeId,
                'actor_id' => $actor->id,
            ]);

            return [
                'changed' => true,
                'conversation' => $locked,
                'previous' => $previous,
                'notification' => $notification,
            ];
        });

        $fresh = $result['conversation']->fresh();
        $this->realtime->conversationUpdated($fresh, [$result['previous']]);
        if ($result['notification']) {
            $this->realtime->notificationCreated($result['notification']);
        }

        return [
            'changed' => $result['changed'],
            'conversation' => $fresh,
            'notification' => $result['notification'],
        ];
    }
}
