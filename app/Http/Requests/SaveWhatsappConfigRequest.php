<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class SaveWhatsappConfigRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'phone_number_id' => ['required', 'string', 'max:255', 'regex:/\A[0-9]+\z/'],
            'waba_id' => ['nullable', 'string', 'max:255', 'regex:/\A[0-9]+\z/'],
            'pin' => ['nullable', 'string', 'regex:/\A[0-9]{6}\z/'],
            'access_token' => ['nullable', 'string'],
            'verify_token' => ['nullable', 'string'],
        ];
    }
}
