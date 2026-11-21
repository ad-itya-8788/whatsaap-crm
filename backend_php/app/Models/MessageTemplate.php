<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MessageTemplate extends Model
{
    protected $fillable = [
        'user_id', 'name', 'category', 'language', 'header_type', 'header_content', 'header_media_url', 'header_handle',
        'header_data', 'body_text', 'footer_text', 'buttons', 'sample_values', 'status', 'approval_status',
        'meta_template_id', 'rejection_reason', 'quality_score', 'submission_error', 'last_submitted_at', 'last_synced_at',
    ];

    protected $casts = [
        'header_data' => 'array',
        'buttons' => 'array',
        'sample_values' => 'array',
        'last_submitted_at' => 'datetime',
        'last_synced_at' => 'datetime',
    ];
}
