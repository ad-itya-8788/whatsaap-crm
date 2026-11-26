<?php

namespace App\Http\Requests;

use App\Support\WhatsappMedia;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\UploadedFile;

class UploadTemplateMediaRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type' => ['required', 'in:IMAGE,VIDEO,DOCUMENT'],
            'file' => [
                'required',
                'file',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($value instanceof UploadedFile && ($error = WhatsappMedia::uploadError($value, (string) $this->input('type')))) {
                        $fail($error);
                    }
                },
            ],
        ];
    }
}
