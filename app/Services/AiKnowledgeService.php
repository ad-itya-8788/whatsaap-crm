<?php

namespace App\Services;

use App\Models\AiKnowledgeChunk;
use App\Models\AiKnowledgeDocument;

class AiKnowledgeService
{
    public function __construct(private AiProviderService $provider) {}

    public function documents()
    {
        return AiKnowledgeDocument::query()->latest()->get();
    }

    public function create(array $data): AiKnowledgeDocument
    {
        return AiKnowledgeDocument::create($data);
    }

    public function update(AiKnowledgeDocument $document, array $data): AiKnowledgeDocument
    {
        $document->update($data);

        return $document->refresh();
    }

    public function delete(AiKnowledgeDocument $document): void
    {
        $document->delete();
    }

    public function reindex(array $settings): int
    {
        $count = 0;

        AiKnowledgeDocument::query()->where('is_active', true)->each(function (AiKnowledgeDocument $document) use ($settings, &$count) {
            $document->chunks()->delete();
            $contents = $this->chunk($document->content);
            $vectors = $this->provider->embed($settings, $contents);

            foreach ($contents as $index => $content) {
                AiKnowledgeChunk::create([
                    'document_id' => $document->id,
                    'chunk_index' => $index,
                    'content' => $content,
                    'embedding' => isset($vectors[$index]) ? json_encode($vectors[$index]) : null,
                ]);
                $count++;
            }
        });

        return $count;
    }

    public function search(array $settings, string $query, int $limit = 5): array
    {
        $chunks = AiKnowledgeChunk::query()
            ->with('document:id,title')
            ->whereHas('document', fn ($query) => $query->where('is_active', true))
            ->get();

        if ($chunks->isEmpty()) {
            return [];
        }

        $queryVector = $this->provider->embed($settings, [$query])[0] ?? null;

        $scored = $chunks->map(function (AiKnowledgeChunk $chunk) use ($query, $queryVector) {
            $semantic = 0.0;
            if ($queryVector && $chunk->embedding) {
                $vector = json_decode($chunk->embedding, true);
                if (is_array($vector)) {
                    $semantic = $this->cosine($queryVector, $vector);
                }
            }

            $lexical = 0;
            foreach ($this->tokens($query) as $token) {
                $lexical += substr_count(mb_strtolower($chunk->content), $token);
            }

            return [
                'title' => $chunk->document?->title,
                'content' => $chunk->content,
                'score' => ($semantic * 10) + $lexical,
            ];
        })
            ->filter(fn (array $item) => $item['score'] > 0)
            ->sortByDesc('score')
            ->take($limit)
            ->values()
            ->all();

        return $scored;
    }

    public function context(array $settings, string $query): string
    {
        $results = $this->search($settings, $query);
        if (! $results) {
            return '';
        }

        return collect($results)
            ->map(fn (array $item, int $index) => '['.($index + 1).'] '.$item['title']."\n".$item['content'])
            ->implode("\n\n");
    }

    private function chunk(string $text, int $size = 1200, int $overlap = 150): array
    {
        $text = preg_replace('/\s+/u', ' ', trim($text)) ?: '';
        $length = mb_strlen($text);

        if ($length <= $size) {
            return $length ? [$text] : [];
        }

        $chunks = [];
        $start = 0;

        while ($start < $length) {
            $chunks[] = mb_substr($text, $start, $size);
            if ($start + $size >= $length) {
                break;
            }
            $start += $size - $overlap;
        }

        return $chunks;
    }

    private function tokens(string $text): array
    {
        return collect(preg_split('/\W+/u', mb_strtolower($text)) ?: [])
            ->filter(fn ($token) => mb_strlen($token) >= 3)
            ->unique()
            ->values()
            ->all();
    }

    private function cosine(array $a, array $b): float
    {
        $dot = 0.0;
        $normA = 0.0;
        $normB = 0.0;
        $length = min(count($a), count($b));

        for ($i = 0; $i < $length; $i++) {
            $x = (float) $a[$i];
            $y = (float) $b[$i];
            $dot += $x * $y;
            $normA += $x * $x;
            $normB += $y * $y;
        }

        if ($normA === 0.0 || $normB === 0.0) {
            return 0.0;
        }

        return $dot / (sqrt($normA) * sqrt($normB));
    }
}
