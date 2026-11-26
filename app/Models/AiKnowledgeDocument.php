<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AiKnowledgeDocument extends Model
{
    protected $fillable = ['title', 'content', 'source', 'is_active'];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function chunks(): HasMany
    {
        return $this->hasMany(AiKnowledgeChunk::class, 'document_id');
    }
}
