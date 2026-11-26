<?php

namespace App\Exceptions;

use RuntimeException;

class MetaApiException extends RuntimeException
{
    public function __construct(
        string $message,
        public int $httpStatus,
        public bool $acceptanceUnknown = false,
        public ?int $providerCode = null,
    ) {
        parent::__construct($message);
    }
}
