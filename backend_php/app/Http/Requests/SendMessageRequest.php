<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\Validator;
use App\Support\InteractiveMessage;
use App\Support\WhatsappMedia;
use App\Models\MessageTemplate;

class SendMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'content_type' => ['required', 'in:text,image,video,audio,document,interactive,template'],
            'content_text' => [
                'required_if:content_type,text,interactive',
                'nullable',
                'string',
                'max:4096',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    $type = (string) $this->input('content_type');
                    if (! in_array($type, ['text', 'image', 'video', 'audio', 'document'], true) && is_string($value) && mb_strlen($value) > 1024) {
                        $fail('Interactive message text cannot exceed 1024 characters.');
                    } elseif (! in_array($type, ['text', 'interactive'], true) && is_string($value) && mb_strlen($value) > 1024) {
                        $fail('Attachment captions cannot exceed 1024 characters.');
                    }
                },
            ],
            'file' => [
                'required_if:content_type,image,video,audio,document',
                'prohibited_if:content_type,text,interactive,template',
                'nullable',
                'file',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($value instanceof UploadedFile && ($error = WhatsappMedia::uploadError($value, (string) $this->input('content_type')))) {
                        $fail($error);
                    }
                },
            ],
            'interactive_payload' => ['required_if:content_type,interactive', 'prohibited_unless:content_type,interactive', 'array', 'max:64'],
            'template_name' => ['required_if:content_type,template', 'prohibited_unless:content_type,template', 'string', 'max:512', 'exists:message_templates,name'],
            'template_language' => ['nullable', 'string', 'max:16'],
            'template_params' => ['nullable', 'array', 'max:20'],
            'template_params.*' => ['nullable', 'string', 'max:1024'],
            'header_text' => ['nullable', 'string', 'max:1024'],
            'button_params' => ['nullable', 'array', 'max:10'],
            'button_params.*' => ['nullable', 'string', 'max:1024'],
            'header_file' => ['nullable', 'file'],
            'reply_to_message_id' => ['nullable', 'integer', 'exists:messages,id'],
            'idempotency_key' => ['nullable', 'string', 'max:128'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($this->input('content_type') === 'interactive') {
                $this->validateInteractive($validator);
            }

            if ($this->input('content_type') === 'template') {
                $this->validateTemplateFile($validator);
            }
        });
    }

    private function validateInteractive(Validator $validator): void
    {
        $payload = $this->input('interactive_payload');
        if (is_array($payload)) {
            $payload['body'] ??= $this->input('content_text');
        }

        $interactive = InteractiveMessage::validate($payload);
        foreach ($interactive->errors()->messages() as $field => $messages) {
            foreach ($messages as $message) {
                $validator->errors()->add($field, $message);
            }
        }
    }

    private function validateTemplateFile(Validator $validator): void
    {
        $file = $this->file('header_file');
        if (! $file) {
            return;
        }

        $template = MessageTemplate::query()->where('name', $this->input('template_name'))->first();
        $type = strtolower((string) ($template?->header_type ?? ''));

        if (! in_array($type, ['image', 'video', 'document'], true)) {
            $validator->errors()->add('header_file', 'This template does not use a media header.');

            return;
        }

        if (($error = WhatsappMedia::uploadError($file, $type))) {
            $validator->errors()->add('header_file', $error);
        }
    }
}
