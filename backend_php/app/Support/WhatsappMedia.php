<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;

class WhatsappMedia
{
    private const LIMITS = [
        'image' => 5 * 1024 * 1024,
        'video' => 16 * 1024 * 1024,
        'audio' => 16 * 1024 * 1024,
        'document' => 100 * 1024 * 1024,
    ];

    private const MIME_TYPES = [
        'image' => ['image/jpeg', 'image/png'],
        'video' => ['video/mp4', 'video/3gpp'],
        'audio' => ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/opus'],
        'document' => [
            'application/pdf',
            'text/plain',
            'text/csv',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ],
    ];

    public static function uploadError(UploadedFile $file, string $type): ?string
    {
        $type = strtolower($type);
        if (! isset(self::MIME_TYPES[$type])) {
            return 'This WhatsApp attachment type is not supported.';
        }

        if (! in_array($file->getMimeType(), self::MIME_TYPES[$type], true)) {
            return 'Choose a supported '.$type.' file.';
        }

        if ($file->getSize() > self::LIMITS[$type]) {
            $limit = self::LIMITS[$type] / (1024 * 1024);

            return "The {$type} file exceeds the {$limit} MB WhatsApp limit.";
        }

        return null;
    }

    public static function maxBytes(string $type): int
    {
        return self::LIMITS[strtolower($type)] ?? self::LIMITS['document'];
    }
}
