<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreBroadcastRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'template_id' => ['required', 'exists:message_templates,id'],
            'scheduled_at' => ['nullable', 'date', 'after_or_equal:now'],
            'send_now' => ['nullable', 'boolean'],
            'audience' => ['required', 'array'],
            'audience.type' => ['required', 'in:all,tags,custom_field,csv'],
            'audience.tag_ids' => ['nullable', 'array'],
            'audience.tag_ids.*' => ['exists:tags,id'],
            'audience.exclude_tag_ids' => ['nullable', 'array'],
            'audience.exclude_tag_ids.*' => ['exists:tags,id'],
            'audience.custom_field_id' => ['nullable', 'exists:custom_fields,id'],
            'audience.operator' => ['nullable', 'in:is,is_not,contains'],
            'audience.value' => ['nullable', 'string', 'max:255'],
            'audience.phones' => ['nullable', 'string'],
            'audience.csv_file' => ['nullable', 'file', 'mimes:txt,csv', 'max:2048'],
            'personalization' => ['nullable', 'array'],
        ];
    }
}
