// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Behind a reverse proxy that terminates TLS the kernel must see the public scheme, or its cookies
 * lack Secure (issue #97): the distributions that run behind a proxy turn the forwarded headers on,
 * believed only from the proxies they name, and the others carry the settings commented.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

describe('distributions behind a reverse proxy (#97)', () => {
  it('Docker Compose believes the forwarded headers of MOSAIKIT_TRUSTED_PROXIES only', () => {
    const compose = parse(read('distribution/docker/compose.yaml')) as {
      services: { mosaikit: { environment: Record<string, string> } };
    };
    const env = compose.services.mosaikit.environment;
    expect(env.QUARKUS_HTTP_PROXY_PROXY_ADDRESS_FORWARDING).toBe('true');
    expect(env.QUARKUS_HTTP_PROXY_ALLOW_X_FORWARDED).toBe('true');
    // Never empty, which would believe every client: by default the container itself only.
    expect(env.QUARKUS_HTTP_PROXY_TRUSTED_PROXIES).toBe('${MOSAIKIT_TRUSTED_PROXIES:-127.0.0.1}');
  });

  it('the installation and the portable distribution name the settings, with trusted proxies', () => {
    for (const path of [
      'distribution/install/application.properties',
      'distribution/portable/application.properties',
    ]) {
      const properties = read(path);
      expect(properties, path).toContain('#quarkus.http.proxy.proxy-address-forwarding=true');
      expect(properties, path).toContain('#quarkus.http.proxy.allow-x-forwarded=true');
      expect(properties, path).toContain('#quarkus.http.proxy.trusted-proxies=');
    }
  });
});
