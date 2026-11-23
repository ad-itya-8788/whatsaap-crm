<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tag;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class TagController extends Controller
{
    public function index(): JsonResponse
    {
        $tags = Tag::query()->withCount('contacts')->orderBy('name')->get()
            ->map(fn (Tag $tag) => [
                'id' => $tag->id,
                'name' => $tag->name,
                'color' => $tag->color,
                'contacts_count' => $tag->contacts_count,
            ]);

        return response()->json($tags);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:tags,name'],
            'color' => ['nullable', 'string', 'max:20'],
        ]);

        return response()->json(Tag::create($data), 201);
    }

    public function update(Request $request, Tag $tag): Response
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255', 'unique:tags,name,'.$tag->id],
            'color' => ['nullable', 'string', 'max:20'],
        ]);

        $tag->update($data);

        return response()->noContent();
    }

    public function destroy(Tag $tag): Response
    {
        $tag->delete();

        return response()->noContent();
    }
}
