<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ConversationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $perPage = min(max($request->integer('per_page', 50), 1), 100);
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:255'],
            'status' => ['sometimes', 'in:all,unread,open,pending,closed'],
            'assigned' => ['sometimes', 'string', function ($attribute, $value, $fail) {
                if (! in_array($value, ['all', 'me', 'unassigned'], true) && ! ctype_digit((string) $value)) {
                    $fail('The selected assigned filter is invalid.');
                }
            }],
        ]);

        $query = Conversation::query()
            ->with(['contact.tags', 'assignedAgent'])
            ->withCount('notes');

        if ($search = $request->string('search')->toString()) {
            $query->whereHas('contact', function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%")
                    ->orWhere('phone_normalized', 'like', "%{$search}%");
            });
        }

        if (isset($filters['status']) && $filters['status'] === 'unread') {
            $query->where('unread_count', '>', 0);
        } elseif (isset($filters['status']) && $filters['status'] !== 'all') {
            $query->where('status', $filters['status']);
        }

        $assigned = $filters['assigned'] ?? 'all';
        if ($assigned === 'me') {
            $query->where('assigned_agent_id', $request->user()->id);
        } elseif ($assigned === 'unassigned') {
            $query->whereNull('assigned_agent_id');
        } elseif (ctype_digit((string) $assigned)) {
            $query->where('assigned_agent_id', (int) $assigned);
        }

        return response()->json(
            $query->orderByDesc('last_message_at')->orderByDesc('updated_at')->paginate($perPage)
        );
    }

    public function show(Conversation $conversation): JsonResponse
    {
        return response()->json($conversation->load(['contact', 'assignedAgent']));
    }

    public function markRead(Conversation $conversation): JsonResponse
    {
        $conversation->update(['unread_count' => 0]);

        return response()->json(['ok' => true]);
    }

    public function start(Request $request): JsonResponse
    {
        $data = $request->validate(['contact_id' => ['required', 'integer', 'exists:contacts,id']]);

        $conversation = Conversation::firstOrCreate(
            ['contact_id' => $data['contact_id']],
            ['user_id' => $request->user()->id, 'status' => 'open'],
        );

        return response()->json($conversation->load('contact'));
    }

    public function agents(): JsonResponse
    {
        $agents = User::query()
            ->where('is_active', true)
            ->whereIn('role', ['agent', 'admin', 'owner'])
            ->orderBy('name')
            ->get(['id', 'name']);

        return response()->json($agents);
    }

    public function assign(Request $request, Conversation $conversation): JsonResponse
    {
        $data = $request->validate([
            'assignee_id' => ['nullable', 'integer', 'exists:users,id'],
        ]);

        $conversation->update(['assigned_agent_id' => $data['assignee_id'] ?? null]);

        return response()->json($conversation->load(['contact', 'assignedAgent']));
    }

    public function updateStatus(Request $request, Conversation $conversation): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'in:open,pending,closed'],
        ]);

        $conversation->update([
            'status' => $data['status'],
            'closed_at' => $data['status'] === 'closed' ? now() : null,
        ]);

        return response()->json($conversation->load(['contact', 'assignedAgent']));
    }
}
