<?php

namespace App\Exceptions;

use App\Models\Message;
use RuntimeException;

class MessagingException extends RuntimeException
{
    public function __construct(string $message, public int $status = 422, public ?Message $failedMessage = null)
    {
        parent::__construct($message);
    }
}
