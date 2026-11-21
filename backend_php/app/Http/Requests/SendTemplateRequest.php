<?php

namespace App\Http\Requests;

use App\Support\WhatsappMedia;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

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
            'header_file' => ['nullable', 'file'],
            'idempotency_key' => ['nullable', 'string', 'max:128'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $template = $this->route('message_template');
            $type = strtoupper((string) ($template?->header_type ?? ''));
            $needsFile = in_array($type, ['IMAGE', 'VIDEO', 'DOCUMENT'], true);
            $file = $this->file('header_file');

            if ($needsFile && ! $file) {
                $validator->errors()->add('header_file', 'Attach a file for this template media header.');

                return;
            }

            if (! $needsFile && $file) {
                $validator->errors()->add('header_file', 'This template does not use a media header.');

                return;
            }

            if ($file && ($error = WhatsappMedia::uploadError($file, strtolower($type)))) {
                $validator->errors()->add('header_file', $error);
            }
        });
    }
}
