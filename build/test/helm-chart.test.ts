// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';

/**
 * The Helm chart renders the extra settings of the kernel and of extensions (MK-129). Runs with the
 * helm of the environment variable HELM, or helm on the path; skipped where there is none.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));
const chart = join(root, 'distribution', 'k8s', 'mosaikit');
const helm = process.env.HELM ?? 'helm';
const available = spawnSync(helm, ['version', '--short'], { encoding: 'utf8' }).status === 0;
const work = mkdtempSync(join(tmpdir(), 'mosaikit-chart-'));

interface EnvVar {
  name: string;
  value?: string;
  valueFrom?: Record<string, { name: string; key: string }>;
}

interface Container {
  env: EnvVar[];
  envFrom?: unknown[];
}

function render(values: string): Container {
  const file = join(work, `values-${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(file, values);
  const output = execFileSync(helm, ['template', 'test', chart, '-f', file], { encoding: 'utf8' });
  const deployment = parseAllDocuments(output)
    .map((document) => document.toJS() as { kind?: string; spec?: unknown })
    .find((document) => document.kind === 'Deployment') as {
    spec: { template: { spec: { containers: Container[] } } };
  };
  const container = deployment.spec.template.spec.containers[0];
  if (!container) {
    throw new Error('no container');
  }
  return container;
}

function refused(values: string): string {
  const file = join(work, `refused-${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(file, values);
  const result = spawnSync(helm, ['template', 'test', chart, '-f', file], { encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  return result.stderr;
}

describe.skipIf(!available)(
  'the Helm chart passes settings to the kernel and extensions (MK-129)',
  () => {
    afterAll(() => {
      rmSync(work, { recursive: true, force: true });
    });

    it('renders the settings of the kernel and of an extension as variables, secrets by reference', () => {
      const container = render(`
kernel:
  extraSettings:
    mosaikit.accounts.session-timeout: 4h
    quarkus.log.category."dev.mosaikit".level: DEBUG
    mosaikit.secrets.master-key:
      valueFrom:
        secretKeyRef: { name: mosaikit-secrets, key: master-key }
  extraEnv:
    - name: TZ
      value: Europe/Rome
  extraEnvFrom:
    - secretRef: { name: mosaikit-more }
extensions:
  signatures: required
  org.example.reports:
    settings:
      example.reports.endpoint: https://reports.example.org
      example.reports.timeout: 30
      example.reports.api-key:
        valueFrom:
          secretKeyRef: { name: reports, key: api-key }
`);
      const env = new Map(container.env.map((variable) => [variable.name, variable]));
      expect(env.get('EXAMPLE_REPORTS_ENDPOINT')?.value).toBe('https://reports.example.org');
      expect(env.get('EXAMPLE_REPORTS_TIMEOUT')?.value).toBe('30');
      expect(env.get('EXAMPLE_REPORTS_API_KEY')).toEqual({
        name: 'EXAMPLE_REPORTS_API_KEY',
        valueFrom: { secretKeyRef: { name: 'reports', key: 'api-key' } },
      });
      expect(env.get('MOSAIKIT_ACCOUNTS_SESSION_TIMEOUT')?.value).toBe('4h');
      expect(env.get('QUARKUS_LOG_CATEGORY__DEV_MOSAIKIT__LEVEL')?.value).toBe('DEBUG');
      expect(env.get('MOSAIKIT_SECRETS_MASTER_KEY')?.valueFrom).toEqual({
        secretKeyRef: { name: 'mosaikit-secrets', key: 'master-key' },
      });
      expect(env.get('TZ')?.value).toBe('Europe/Rome');
      expect(env.get('MOSAIKIT_EXTENSIONS_SIGNATURES')?.value).toBe('required');
      expect(container.envFrom).toEqual([{ secretRef: { name: 'mosaikit-more' } }]);
      // The extra settings come after those of the chart, so that they win.
      const names = container.env.map((variable) => variable.name);
      expect(names.indexOf('EXAMPLE_REPORTS_ENDPOINT')).toBeGreaterThan(
        names.indexOf('MOSAIKIT_FILES_STORE'),
      );
    });

    it('renders nothing more by default', () => {
      const container = render('{}\n');
      expect(container.env.map((variable) => variable.name)).not.toContain('TZ');
      expect(container.env.every((variable) => /^(QUARKUS|MOSAIKIT)_/.test(variable.name))).toBe(
        true,
      );
      expect(container.envFrom).toBeUndefined();
    });

    it('has the kernel believe the forwarded headers of the ingress, from named proxies outside ClusterIP (#97)', () => {
      const variables = (container: Container) =>
        new Map(container.env.map((variable) => [variable.name, variable.value]));
      const byDefault = variables(render('{}\n'));
      expect(byDefault.get('QUARKUS_HTTP_PROXY_PROXY_ADDRESS_FORWARDING')).toBe('true');
      expect(byDefault.get('QUARKUS_HTTP_PROXY_ALLOW_X_FORWARDED')).toBe('true');
      expect(byDefault.has('QUARKUS_HTTP_PROXY_TRUSTED_PROXIES')).toBe(false);
      expect(byDefault.has('MOSAIKIT_ACCOUNTS_SECURE_COOKIES')).toBe(false);

      const named = variables(
        render(
          'service:\n  type: LoadBalancer\nproxy:\n  trustedProxies: 10.244.0.0/16\n  secureCookies: true\n',
        ),
      );
      expect(named.get('QUARKUS_HTTP_PROXY_TRUSTED_PROXIES')).toBe('10.244.0.0/16');
      expect(named.get('MOSAIKIT_ACCOUNTS_SECURE_COOKIES')).toBe('true');

      expect(refused('service:\n  type: NodePort\n')).toContain('proxy.trustedProxies');
      const off = variables(
        render('service:\n  type: NodePort\nproxy:\n  forwardedHeaders: false\n'),
      );
      expect(off.has('QUARKUS_HTTP_PROXY_PROXY_ADDRESS_FORWARDING')).toBe(false);
    });

    it('refuses a name that is not a setting and a value that is neither clear nor a reference', () => {
      expect(refused('kernel:\n  extraSettings:\n    "bad name": x\n')).toContain(
        'is not the name of a setting',
      );
      expect(
        refused(
          'extensions:\n  org.example.reports:\n    settings:\n      example.reports.api-key:\n        secretKeyRef: { name: reports, key: api-key }\n',
        ),
      ).toContain('without valueFrom');
      expect(
        refused(
          'kernel:\n  extraSettings:\n    example.pod:\n      valueFrom:\n        fieldRef: { fieldPath: metadata.name }\n',
        ),
      ).toContain('takes secretKeyRef or configMapKeyRef');
      expect(refused('kernel:\n  extraSettings:\n    example.empty: null\n')).toContain(
        'needs a value',
      );
    });
  },
);
