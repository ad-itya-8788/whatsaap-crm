<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ApiKey;
use App\Models\WebhookEndpoint;
use App\Services\OutboundWebhookTarget;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class WebhookEndpointController extends Controller
{
    public function __construct(private OutboundWebhookTarget $target) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => WebhookEndpoint::query()->latest('id')->get()]);
    }

    public function show(WebhookEndpoint $webhookEndpoint): JsonResponse
    {
        return response()->json(['data' => $webhookEndpoint]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateInput($request);
        $secret = 'whsec_'.bin2hex(random_bytes(32));
        $endpoint = WebhookEndpoint::create($data + [
            'created_by' => $request->attributes->get(ApiKey::class)->created_by,
            'secret' => $secret,
        ])->refresh();

        return response()->json(['data' => $endpoint->toArray() + ['secret' => $secret]], 201)
            ->header('Cache-Control', 'no-store');
    }

    public function update(Request $request, WebhookEndpoint $webhookEndpoint): JsonResponse
    {
        $data = $this->validateInput($request);
        $webhookEndpoint->fill($data);
        if (array_key_exists('url', $data) || ($data['is_active'] ?? false)) {
            $webhookEndpoint->failure_count = 0;
        }
        $webhookEndpoint->save();

        return $this->show($webhookEndpoint);
    }

    public function destroy(WebhookEndpoint $webhookEndpoint): Response
    {
        $webhookEndpoint->delete();

        return response()->noContent();
    }

    private function validateInput(Request $request): array
    {
        $presence = $request->isMethod('post') ? 'required' : 'sometimes';
        $data = $request->validate([
            'url' => [$presence, 'required', 'url:https', 'max:255'],
            'events' => [$presence, 'required', 'array', 'list', 'min:1', 'max:3'],
            'events.*' => ['required', 'string', 'distinct', Rule::in(WebhookEndpoint::EVENTS)],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        if (isset($data['url']) && $this->target->resolve($data['url']) === null) {
            throw ValidationException::withMessages(['url' => 'Enter a public HTTPS webhook URL on port 443.']);
        }

        return $data;
    }
}
