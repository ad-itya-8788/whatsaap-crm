<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use App\Models\User;
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
        $user = $request->user();
        $data['queue'] = $this->visibleThreads($user, $data['queue']);
        $data['attention']['queue'] = $data['queue'];
        $data['attention']['failedMessages'] = $this->visibleThreads($user, $data['attention']['failedMessages']);

        return response()->json($data);
    }

    public function activity(Request $request): JsonResponse
    {
        $limit = min(max($request->integer('limit', 5), 1), 5);

        return response()->json($this->visibleThreads($request->user(), $this->dashboard->activity($limit)));
    }

    public function campaigns(Request $request): JsonResponse
    {
        $data = $this->dashboard->campaigns($this->days($request));
        $data['failures'] = $this->visibleThreads($request->user(), $data['failures']);

        return response()->json($data);
    }

    public function hourlyVolume(Request $request): JsonResponse
    {
        return response()->json($this->dashboard->hourlyVolume($this->days($request)));
    }

    private function visibleThreads(User $user, array $rows): array
    {
        if ($user->isOwner()) {
            return $rows;
        }
        if (! $user->hasModuleAccess('inbox') || ! $rows) {
            return [];
        }
        $ids = Conversation::where('assigned_agent_id', $user->id)
            ->whereIn('id', array_column($rows, 'conversationId'))->pluck('id')->all();

        return array_values(array_filter($rows, fn ($row) => in_array($row['conversationId'], $ids, true)));
    }

    private function days(Request $request): int
    {
        $validated = $request->validate([
            'days' => ['sometimes', 'integer', 'in:1,7,30,90'],
        ]);

        return (int) ($validated['days'] ?? 7);
    }
}
