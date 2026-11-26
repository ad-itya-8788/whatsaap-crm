<?php

namespace App\Services;

class OutboundWebhookTarget
{
    /**
     * Resolve once, validate the results, and give cURL the same address to connect to.
     */
    public function resolve(string $url): ?array
    {
        $parts = parse_url($url);
        $host = strtolower($parts['host'] ?? '');
        $port = $parts['port'] ?? 443;
        if (strtolower($parts['scheme'] ?? '') !== 'https' || $host === ''
            || isset($parts['user']) || isset($parts['fragment']) || $port !== 443) {
            return null;
        }

        $literal = trim($host, '[]');
        if (filter_var($literal, FILTER_VALIDATE_IP)) {
            return $this->isPublic($literal) ? [] : null;
        }
        if (str_ends_with($host, '.') || ! str_contains($host, '.') || ! filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) {
            return null;
        }

        $records = @dns_get_record($host, DNS_A | DNS_AAAA);
        $addresses = [];
        foreach ($records ?: [] as $record) {
            $ip = $record['ip'] ?? $record['ipv6'] ?? null;
            if ($ip === null) {
                continue;
            }
            if (! $this->isPublic($ip)) {
                return null;
            }
            $addresses[] = $ip;
        }
        if (! $addresses) {
            return null;
        }

        $address = $addresses[0];
        if (str_contains($address, ':')) {
            $address = '['.$address.']';
        }

        return [CURLOPT_RESOLVE => [$host.':'.$port.':'.$address]];
    }

    private function isPublic(string $ip): bool
    {
        return (bool) filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_GLOBAL_RANGE)
            && ! str_starts_with(strtolower($ip), '::ffff:');
    }
}
