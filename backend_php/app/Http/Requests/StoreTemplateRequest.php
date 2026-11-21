<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreTemplateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $required = $this->isMethod('post') ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:255', 'regex:/^[a-z0-9_]+$/', Rule::unique('message_templates', 'name')->ignore($this->route('message_template')?->id)],
            'category' => [$required, 'in:UTILITY,MARKETING,AUTHENTICATION'],
            'language' => [$required, 'string', 'max:20'],
            'body_text' => [$required, 'string', 'max:4096'],
            'header_data' => ['nullable', 'array'],
            'header_data.type' => ['nullable', 'in:TEXT,IMAGE,VIDEO,DOCUMENT'],
            'header_data.text' => ['nullable', 'string', 'max:60'],
            'footer_text' => ['nullable', 'string', 'max:2048'],
            'buttons' => ['nullable', 'array', 'max:3'],
            'buttons.*' => ['string', 'max:128'],
            'sample_values' => ['nullable', 'array'],
            'sample_values.*' => ['string', 'max:255'],
        ];
    }
}
