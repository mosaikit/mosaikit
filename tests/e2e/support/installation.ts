// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { fromEnvironment } from '../../../sdk/testing/src/bench.js';
import type { Settings } from '../../../sdk/testing/src/installation.js';

export type { Settings };

/** The settings the test installation started with, to change some of them at a restart. */
export function defaultSettings(): Settings {
  return { ...fromEnvironment().settings };
}
