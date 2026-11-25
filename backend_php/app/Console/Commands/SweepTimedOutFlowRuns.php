<?php

namespace App\Console\Commands;

use App\Services\FlowEngine;
use Illuminate\Console\Command;

class SweepTimedOutFlowRuns extends Command
{
    protected $signature = 'flows:sweep-timeouts';

    protected $description = 'End flow runs that exceeded their timeout policy';

    public function handle(FlowEngine $engine): int
    {
        $count = $engine->sweepTimeouts();
        $this->info("Ended {$count} timed-out flow runs.");

        return self::SUCCESS;
    }
}
