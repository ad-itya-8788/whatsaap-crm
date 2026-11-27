<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\DashboardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    public function __construct(private readonly DashboardService $dashboard)
    {
    }

    public function overview(Request $request): JsonResponse
    {
        $data = $this->dashboard->overview($this->days($request));
        $access = app(\App\Auth\Access::class);
        $sources = [
            'whatsapp.view' => ['whatsappConnected', 'whatsappPhoneNumberId', 'whatsappStatus', 'whatsappDisplayPhone', 'whatsappRegistrationError', 'whatsappPendingApproval'],
            'templates.view' => ['templates'],
            'quick_replies.view' => ['quickReplies'],
            'contacts.view' => ['contacts'],
            'tags.view' => ['tags'],
            'custom_fields.view' => ['customFields'],
        ];
        foreach ($sources as $permission => $keys) {
            if (! $access->can($request->user(), $permission)) {
                $data['setup'] = array_diff_key($data['setup'], array_flip($keys));
            }
        }

        return response()->json($data);
    }

    public function activity(Request $request): JsonResponse
    {
        $limit = min(max($request->integer('limit', 5), 1), 5);

        return response()->json($this->dashboard->activity($limit));
    }

    public function campaigns(Request $request): JsonResponse
    {
        return response()->json($this->dashboard->campaigns($this->days($request)));
    }

    public function hourlyVolume(Request $request): JsonResponse
    {
        return response()->json($this->dashboard->hourlyVolume($this->days($request)));
    }

    private function days(Request $request): int
    {
        $validated = $request->validate([
            'days' => ['sometimes', 'integer', 'in:1,7,30,90'],
        ]);

        return (int) ($validated['days'] ?? 7);
    }
}
