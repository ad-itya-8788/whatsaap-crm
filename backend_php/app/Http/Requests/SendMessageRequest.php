<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\UploadedFile;
use App\Support\WhatsappMedia;

class SendMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'content_type' => ['required', 'in:text,image,video,audio,document'],
            'content_text' => [
                'required_if:content_type,text',
                'nullable',
                'string',
                'max:4096',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($this->input('content_type') !== 'text' && is_string($value) && mb_strlen($value) > 1024) {
                        $fail('Attachment captions cannot exceed 1024 characters.');
                    }
                },
            ],
            'file' => [
                'required_if:content_type,image,video,audio,document',
                'prohibited_if:content_type,text',
                'nullable',
                'file',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($value instanceof UploadedFile && ($error = WhatsappMedia::uploadError($value, (string) $this->input('content_type')))) {
                        $fail($error);
                    }
                },
            ],
            'reply_to_message_id' => ['nullable', 'integer', 'exists:messages,id'],
            'idempotency_key' => ['nullable', 'string', 'max:128'],
        ];
    }
}
