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
        return response()->json($this->dashboard->overview($this->days($request)));
    }

    public function attention(): JsonResponse
    {
        return response()->json($this->dashboard->attention());
    }

    public function activity(Request $request): JsonResponse
    {
        $limit = min(max($request->integer('limit', 50), 1), 100);

        return response()->json($this->dashboard->activity($limit));
    }

    public function campaigns(Request $request): JsonResponse
    {
        return response()->json($this->dashboard->campaigns($this->days($request)));
    }

    public function team(): JsonResponse
    {
        return response()->json($this->dashboard->team());
    }

    public function setup(): JsonResponse
    {
        return response()->json($this->dashboard->setup());
    }

    public function volume(Request $request): JsonResponse
    {
        return response()->json($this->dashboard->volume($this->days($request)));
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
