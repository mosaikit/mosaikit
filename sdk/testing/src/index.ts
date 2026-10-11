// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
export {
  BENCH_ADMIN,
  BENCH_ORGANIZATION,
  BENCH_PEOPLE,
  Bench,
  ENVIRONMENT,
  basic,
  confirmationLink,
  fromEnvironment,
  register,
  type BenchInfo,
  type BenchOptions,
  type Organization,
  type Person,
} from './bench.js';
export {
  Launcher,
  archiveUrl,
  locateInstallation,
  ownVersion,
  writeSettings,
  type Settings,
} from './installation.js';
export { packagesIn } from './packages.js';
export { freePort, startPostgres, type Database } from './postgres.js';
export { Signing, kernelApiJar } from './signing.js';
export { mails, startFakeSmtp, type FakeSmtp, type Mail } from './smtp.js';
