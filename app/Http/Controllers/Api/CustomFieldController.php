<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CustomField;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

class CustomFieldController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = CustomField::query()->orderBy('label');

        if (! app(\App\Auth\Access::class)->can($request->user(), 'custom_fields.update')) {
            $query->where('is_active', true);
        }

        return response()->json(
            $query->get(['id', 'name', 'label', 'type', 'options', 'is_active', 'required'])
        );
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules());

        return response()->json(CustomField::create($data), 201);
    }

    public function update(Request $request, CustomField $customField): JsonResponse
    {
        $data = $request->validate($this->rules($customField));
        $customField->update($data);

        return response()->json($customField);
    }

    public function destroy(CustomField $customField): Response
    {
        $customField->delete();

        return response()->noContent();
    }

    private function rules(?CustomField $customField = null): array
    {
        $nameRule = Rule::unique('custom_fields', 'name');
        if ($customField) {
            $nameRule->ignore($customField->id);
        }

        return [
            'name' => ['required', 'string', 'max:100', $nameRule],
            'label' => ['required', 'string', 'max:255'],
            'type' => ['required', Rule::in(['text', 'number', 'date', 'select', 'checkbox'])],
            'options' => ['nullable', 'array'],
            'options.*' => ['nullable', 'string', 'max:255'],
            'is_active' => ['sometimes', 'boolean'],
            'required' => ['sometimes', 'boolean'],
        ];
    }
}
