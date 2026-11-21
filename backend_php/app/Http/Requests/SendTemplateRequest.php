<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class SendTemplateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'contact_id' => ['required', 'integer', 'exists:contacts,id'],
            'variables' => ['nullable', 'array'],
            'variables.*' => ['string', 'max:1024'],
        ];
    }
}
