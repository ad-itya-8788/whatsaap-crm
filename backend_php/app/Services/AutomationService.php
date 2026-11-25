<?php

namespace App\Services;

use App\Models\Automation;
use App\Models\AutomationStep;
use Illuminate\Support\Facades\DB;

class AutomationService
{
    public function create(array $data, int $userId): Automation
    {
        return DB::transaction(function () use ($data, $userId) {
            $automation = Automation::create([
                'user_id' => $userId,
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'trigger_type' => $data['trigger_type'],
                'trigger_config' => $data['trigger_config'] ?? [],
                'is_active' => (bool) ($data['is_active'] ?? false),
            ]);

            $this->replaceSteps($automation, $data['steps'] ?? []);

            return $automation->refresh()->load('steps');
        });
    }

    public function update(Automation $automation, array $data): Automation
    {
        DB::transaction(function () use ($automation, $data) {
            $automation->update([
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'trigger_type' => $data['trigger_type'],
                'trigger_config' => $data['trigger_config'] ?? [],
                'is_active' => (bool) ($data['is_active'] ?? false),
            ]);

            if (array_key_exists('steps', $data)) {
                $this->replaceSteps($automation, $data['steps']);
            }
        });

        return $automation->refresh()->load('steps');
    }

    public function duplicate(Automation $automation, int $userId): Automation
    {
        return DB::transaction(function () use ($automation, $userId) {
            $copy = Automation::create([
                'user_id' => $userId,
                'name' => $automation->name.' (copy)',
                'description' => $automation->description,
                'trigger_type' => $automation->trigger_type,
                'trigger_config' => $automation->trigger_config,
                'is_active' => false,
            ]);

            $copySteps = function ($steps, ?int $parentId, ?string $branch) use (&$copySteps, $copy): void {
                foreach ($steps as $position => $step) {
                    $model = AutomationStep::create([
                        'automation_id' => $copy->id,
                        'parent_step_id' => $parentId,
                        'branch' => $branch,
                        'step_type' => $step->step_type,
                        'step_config' => $step->step_config,
                        'position' => $position,
                    ]);

                    foreach (['yes', 'no'] as $childBranch) {
                        $copySteps($step->children->where('branch', $childBranch)->sortBy('position'), $model->id, $childBranch);
                    }
                }
            };

            $copySteps(
                $automation->steps->whereNull('parent_step_id')->sortBy('position'),
                null,
                null,
            );

            return $copy->load('steps');
        });
    }

    public function builder(Automation $automation): array
    {
        $automation->load('steps');
        $grouped = $automation->steps->groupBy(fn (AutomationStep $step) => (string) ($step->parent_step_id ?: 'root'));

        $build = function (string $parentKey, ?string $branch) use ($grouped, &$build): array {
            return $grouped->get($parentKey, collect())
                ->filter(fn (AutomationStep $step) => ($step->branch ?: null) === $branch)
                ->sortBy('position')
                ->values()
                ->map(fn (AutomationStep $step) => [
                    'id' => $step->id,
                    'step_type' => $step->step_type,
                    'config' => $step->step_config ?? [],
                    'yes' => $build((string) $step->id, 'yes'),
                    'no' => $build((string) $step->id, 'no'),
                ])
                ->all();
        };

        return [
            'automation' => $automation,
            'steps' => $build('root', null),
        ];
    }

    private function replaceSteps(Automation $automation, array $steps): void
    {
        $keep = [];

        $persist = function (array $scope, ?int $parentId, ?string $branch) use (&$persist, &$keep, $automation): void {
            foreach (array_values($scope) as $position => $step) {
                $id = is_numeric($step['id'] ?? null) ? (int) $step['id'] : null;
                $model = $id
                    ? AutomationStep::where('id', $id)->where('automation_id', $automation->id)->first()
                    : null;

                $attributes = [
                    'automation_id' => $automation->id,
                    'parent_step_id' => $parentId,
                    'branch' => $branch,
                    'step_type' => $step['step_type'] ?? '',
                    'step_config' => $step['config'] ?? [],
                    'position' => $position,
                ];

                if ($model) {
                    $model->update($attributes);
                } else {
                    $model = AutomationStep::create($attributes);
                }

                $keep[] = $model->id;
                foreach (['yes', 'no'] as $childBranch) {
                    $persist(is_array($step[$childBranch] ?? null) ? $step[$childBranch] : [], $model->id, $childBranch);
                }
            }
        };

        $persist($steps, null, null);
        AutomationStep::where('automation_id', $automation->id)
            ->when($keep, fn ($query) => $query->whereNotIn('id', $keep))
            ->delete();
    }
}
