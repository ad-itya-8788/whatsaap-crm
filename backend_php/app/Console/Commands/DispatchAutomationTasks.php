<?php

namespace App\Console\Commands;

use App\Models\Automation;
use App\Models\Contact;
use App\Services\AutomationEngine;
use Illuminate\Console\Command;

class DispatchAutomationTasks extends Command
{
    protected $signature = 'automations:dispatch-pending';

    protected $description = 'Resume due automation waits and run time-based automations';

    public function handle(AutomationEngine $engine): int
    {
        $resumed = $engine->dispatchPending();
        $schedule = now()->format('H:i');
        $triggered = 0;

        Automation::query()
            ->where('is_active', true)
            ->where('trigger_type', 'time_based')
            ->chunkById(50, function ($automations) use ($engine, $schedule, &$triggered) {
                foreach ($automations as $automation) {
                    if ((string) data_get($automation, 'trigger_config.schedule', '') !== $schedule) {
                        continue;
                    }

                    Contact::query()->whereHas('conversations')->chunkById(100, function ($contacts) use ($automation, $engine, $schedule, &$triggered) {
                        foreach ($contacts as $contact) {
                            $conversationId = $contact->conversations()
                                ->latest('last_message_at')
                                ->value('id');

                            if (! $conversationId) {
                                continue;
                            }

                            $engine->run($automation, 'time_based', [
                                'contact_id' => $contact->id,
                                'conversation_id' => (int) $conversationId,
                                'schedule' => $schedule,
                            ]);
                            $triggered++;
                        }
                    });
                }
            });

        $this->info("Resumed {$resumed} pending automation; triggered {$triggered} time-based runs.");

        return self::SUCCESS;
    }
}
