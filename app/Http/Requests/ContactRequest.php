<?php

namespace App\Http\Requests;

use App\Models\CustomField;
use Illuminate\Foundation\Http\FormRequest;

class ContactRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $required = $this->isMethod('post') ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:255'],
            'phone' => [$required, 'string', 'max:50'],
            'wa_user_id' => ['nullable', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'max:255'],
            'company' => ['nullable', 'string', 'max:255'],
            'consent_status' => ['sometimes', 'in:opted_in,opted_out,unknown'],
            'tags' => ['sometimes', 'array'],
            'tags.*' => ['integer', 'exists:tags,id'],
            'custom_fields' => ['sometimes', 'array', function ($attribute, $value, $fail) {
                foreach ($this->customFieldValidationErrors() as $message) {
                    $fail($message);
                }
            }],
        ];
    }

    public function customFieldValues(): array
    {
        return $this->normalizeCustomFields()['values'];
    }

    private function customFieldValidationErrors(): array
    {
        $normalized = $this->normalizeCustomFields();
        $errors = $normalized['errors'];

        foreach ($normalized['values'] as $id => $value) {
            if (! CustomField::whereKey($id)->exists()) {
                $errors[] = "The custom_fields field id {$id} does not exist.";
            }

            if (! is_null($value) && ! is_scalar($value)) {
                $errors[] = "The custom_fields value for field {$id} must be a scalar value.";
            } elseif (! is_null($value) && mb_strlen((string) $value) > 1000) {
                $errors[] = "The custom_fields value for field {$id} may not be greater than 1000 characters.";
            }
        }

        return $errors;
    }

    private function normalizeCustomFields(): array
    {
        $raw = $this->input('custom_fields');
        if (! is_array($raw)) {
            return ['values' => [], 'errors' => []];
        }

        $values = [];
        $errors = [];

        foreach ($raw as $key => $item) {
            if (is_array($item) && array_key_exists('id', $item)) {
                $id = filter_var($item['id'], FILTER_VALIDATE_INT);
                if ($id === false || $id < 1) {
                    $errors[] = 'Each custom_fields id must be a valid field id.';
                    continue;
                }
                $values[$id] = $item['value'] ?? null;
                continue;
            }

            if (filter_var($key, FILTER_VALIDATE_INT) === false || (int) $key < 1) {
                $errors[] = 'custom_fields must be a map of field ids to values or a list of id/value objects.';
                continue;
            }

            $values[(int) $key] = $item;
        }

        return ['values' => $values, 'errors' => $errors];
    }
}
