<?php

namespace App\Support;

use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Validator as MessageValidator;

class InteractiveMessage
{
    public static function validate(mixed $payload): MessageValidator
    {
        $data = ['interactive_payload' => $payload];
        $kind = is_array($payload) ? ($payload['kind'] ?? null) : null;
        $rules = [
            'interactive_payload' => ['required', 'array'],
            'interactive_payload.kind' => ['required', 'in:buttons,list'],
            'interactive_payload.body' => ['required', 'string', 'max:1024'],
            'interactive_payload.header' => ['nullable', 'string', 'max:60'],
            'interactive_payload.footer' => ['nullable', 'string', 'max:60'],
        ];

        if ($kind === 'buttons') {
            $rules += [
                'interactive_payload.buttons' => ['required', 'array', 'list', 'min:1', 'max:3'],
                'interactive_payload.buttons.*' => ['required', 'array:id,title'],
                'interactive_payload.buttons.*.id' => ['required', 'string', 'max:20', 'distinct:strict'],
                'interactive_payload.buttons.*.title' => ['required', 'string', 'max:20'],
            ];
        }

        if ($kind === 'list') {
            $rules += [
                'interactive_payload.button_label' => ['required', 'string', 'max:20'],
                'interactive_payload.sections' => ['required', 'array', 'list', 'min:1', 'max:10'],
                'interactive_payload.sections.*' => ['required', 'array:title,rows'],
                'interactive_payload.sections.*.title' => ['nullable', 'string', 'max:24'],
                'interactive_payload.sections.*.rows' => ['required', 'array', 'list', 'min:1', 'max:10'],
                'interactive_payload.sections.*.rows.*' => ['required', 'array:id,title,description'],
                'interactive_payload.sections.*.rows.*.id' => ['required', 'string', 'max:200', 'distinct:strict'],
                'interactive_payload.sections.*.rows.*.title' => ['required', 'string', 'max:24'],
                'interactive_payload.sections.*.rows.*.description' => ['nullable', 'string', 'max:72'],
            ];
        }

        $validator = Validator::make($data, $rules);
        if ($kind === 'list') {
            $validator->after(function (MessageValidator $validator) use ($payload): void {
                $rows = collect($payload['sections'] ?? [])->sum(
                    fn ($section) => is_array($section) && is_array($section['rows'] ?? null)
                        ? count($section['rows'])
                        : 0
                );
                if ($rows > 10) {
                    $validator->errors()->add('interactive_payload.sections', 'Use at most ten rows in total.');
                }
            });
        }

        return $validator;
    }
}
