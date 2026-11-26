<?php

namespace App\Services;

use App\Models\Conversation;
use App\Models\Message;

class RealtimePayload
{
    public function message(Message $message): array
    {
        $message->loadMissing([
            'replyTo:id,content_text,sender_type,content_type,filename',
            'template:name,body_text',
            'reactions:id,message_id,actor_type,actor_id,emoji,created_at',
        ]);
        $message->reactions->each(fn ($reaction) => $reaction->setAttribute('conversation_id', $message->conversation_id));

        return $message->toArray();
    }

    public function conversation(Conversation $conversation): array
    {
        $conversation->loadMissing(['contact.tags', 'assignedAgent:id,name,avatar_url'])->loadCount('notes');

        return $conversation->toArray();
    }
}
