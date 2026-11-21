<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\ContactRequest;
use App\Models\Contact;
use App\Support\Phone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class ContactController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $perPage = min(max($request->integer('per_page', 25), 1), 100);
        $query = Contact::query();

        if ($search = $request->string('search')->toString()) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%")
                    ->orWhere('phone_normalized', 'like', "%{$search}%")
                    ->orWhere('whatsapp_user_id', 'like', "%{$search}%");
            });
        }

        return response()->json(
            $query->orderByDesc('updated_at')->paginate($perPage)
        );
    }

    public function store(ContactRequest $request): JsonResponse
    {
        $data = $request->validated();
        $data['phone_normalized'] = Phone::normalize($data['phone']);
        $data['user_id'] = $request->user()->id;

        if (! $data['phone_normalized']) {
            return response()->json(['message' => 'A valid phone number is required.'], 422);
        }

        if (Contact::where('phone_normalized', $data['phone_normalized'])->exists()) {
            return response()->json([
                'message' => 'A contact with this phone number already exists.',
                'errors' => ['phone' => ['This phone number is already saved.']],
            ], 422);
        }

        return response()->json(Contact::create($data), 201);
    }

    public function show(Contact $contact): JsonResponse
    {
        return response()->json($contact);
    }

    public function update(ContactRequest $request, Contact $contact): JsonResponse
    {
        $data = $request->validated();

        if (array_key_exists('phone', $data)) {
            $data['phone_normalized'] = Phone::normalize($data['phone']);
            if (! $data['phone_normalized']) {
                return response()->json(['message' => 'A valid phone number is required.'], 422);
            }
            if (Contact::where('phone_normalized', $data['phone_normalized'])->whereKeyNot($contact->id)->exists()) {
                return response()->json([
                    'message' => 'A contact with this phone number already exists.',
                    'errors' => ['phone' => ['This phone number is already saved.']],
                ], 422);
            }
        }

        $contact->update($data);

        return response()->json($contact);
    }

    public function destroy(Contact $contact): Response
    {
        $contact->delete();

        return response()->noContent();
    }
}
