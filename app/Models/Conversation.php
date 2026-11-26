<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
class Conversation extends Model {
    protected $fillable = [
        'user_id','contact_id','status','assigned_agent_id','last_message_text','last_message_at',
        'unread_count','last_inbound_at','last_reply_at','closed_at','first_inbound_at',
        'ai_autoreply_disabled','ai_reply_count','ai_handoff_summary'
    ];
    protected $casts = [
        'last_message_at'=>'datetime','last_inbound_at'=>'datetime','last_reply_at'=>'datetime',
        'closed_at'=>'datetime','first_inbound_at'=>'datetime',
        'ai_autoreply_disabled'=>'boolean','ai_reply_count'=>'integer'
    ];
    public function contact(): BelongsTo { return $this->belongsTo(Contact::class); }
    public function messages(): HasMany { return $this->hasMany(Message::class); }
    public function notes(): HasMany { return $this->hasMany(ConversationNote::class); }
    public function assignedAgent(): BelongsTo { return $this->belongsTo(User::class, 'assigned_agent_id'); }
}
