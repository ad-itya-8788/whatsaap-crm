<?php

namespace App\Exceptions;

use RuntimeException;

class AiException extends RuntimeException
{
    public function __construct(string $message, public int $status = 422, public ?string $key = null)
    {
        parent::__construct($message);
    }
}
