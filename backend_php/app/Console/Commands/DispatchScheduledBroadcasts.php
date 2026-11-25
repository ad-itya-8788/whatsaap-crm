<?php

namespace App\Console\Commands;

use App\Services\BroadcastService;
use Illuminate\Console\Command;

class DispatchScheduledBroadcasts extends Command
{
    protected $signature = 'broadcasts:dispatch-scheduled';

    protected $description = 'Dispatch WhatsApp broadcasts whose scheduled time has arrived.';

    public function handle(BroadcastService $broadcasts): int
    {
        $count = $broadcasts->dispatchScheduled();
        $this->info("Dispatched {$count} scheduled broadcast(s).");

        return self::SUCCESS;
    }
}
