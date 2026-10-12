// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { basename, join } from 'node:path';
import { Bench } from '../../sdk/testing/src/bench.js';
import { packagesIn } from '../../sdk/testing/src/packages.js';
import { readdirSync } from 'node:fs';
import {
  ADMIN,
  ANNA,
  CONTROL_PORT,
  DIST,
  FIXTURES,
  KERNEL_PORT,
  MARIO,
  MODEL_PORT,
  MODEL_URL,
  ORGANIZATION,
  WORK,
} from './support/env.js';
import { startFakeModel } from './support/fake-model.js';

/**
 * Starts the bench of @mosaikit/testing (ADR-0035) on the installation that `./mvnw install`
 * writes to target/dist, with a catalog of the fixture plugins, a fake language model, and a
 * control endpoint with which the tests restart the installation.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const fixtures = readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(FIXTURES, entry.name, 'target'));
  const catalog = packagesIn(...fixtures);
  if (catalog.length === 0) {
    throw new Error('Build first: ./mvnw install -DskipTests (no packages of the fixture plugins)');
  }
  // A group of tests/e2e/run.ts may start with fixtures installed, as the files before it left them.
  const preinstalled = (process.env.E2E_PREINSTALL ?? '').split(',').filter((name) => name !== '');
  const plugins = catalog.filter((file) =>
    preinstalled.some((name) => basename(file).startsWith(`fixture-${name}-`)),
  );
  const model = await startFakeModel(MODEL_PORT);
  const database = process.env.E2E_DB_URL;
  const bench = await Bench.start({
    work: WORK,
    installation: join(DIST, 'mosaikit'),
    catalog,
    plugins,
    port: KERNEL_PORT,
    controlPort: CONTROL_PORT,
    admin: ADMIN,
    organization: ORGANIZATION,
    people: [MARIO, ANNA],
    settings: {
      'mosaikit.assistant.url': MODEL_URL,
      'mosaikit.assistant.model': 'e2e-fake-model',
    },
    ...(database
      ? {
          database: {
            url: database,
            username: process.env.E2E_DB_USERNAME ?? 'mosaikit',
            password: process.env.E2E_DB_PASSWORD ?? 'mosaikit',
          },
        }
      : {}),
  });
  bench.publish();
  return async () => {
    await bench.stop();
    model.close();
  };
}
