// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archiveUrl, locateInstallation, ownVersion } from '../src/installation.js';
import { packagesIn } from '../src/packages.js';

describe('the installation of the bench (MK-050)', () => {
  it('finds a snapshot in the pre-release snapshot and a release in its tag', () => {
    expect(archiveUrl('0.1.0-dev.20261012.42')).toBe(
      'https://github.com/mosaikit/mosaikit/releases/download/snapshot/mosaikit-0.1.0-dev.20261012.42.tar.gz',
    );
    expect(archiveUrl('0.2.0')).toBe(
      'https://github.com/mosaikit/mosaikit/releases/download/v0.2.0/mosaikit-0.2.0.tar.gz',
    );
  });

  it('uses the installation it is given, and refuses a directory that is not one', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mosaikit-bench-'));
    await expect(locateInstallation(directory)).rejects.toThrow('not a Mosaikit installation');
    mkdirSync(join(directory, 'bin', 'kernel'), { recursive: true });
    await expect(locateInstallation(directory)).resolves.toBe(directory);
  });

  it('asks for an installation when it is a build of the repository', async () => {
    expect(ownVersion()).toMatch(/-SNAPSHOT$/);
    const saved = process.env.MOSAIKIT_INSTALLATION;
    delete process.env.MOSAIKIT_INSTALLATION;
    try {
      await expect(locateInstallation()).rejects.toThrow('set MOSAIKIT_INSTALLATION');
    } finally {
      if (saved !== undefined) {
        process.env.MOSAIKIT_INSTALLATION = saved;
      }
    }
  });

  it('lists the packages of the directories that exist', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mosaikit-packages-'));
    writeFileSync(join(directory, 'notes-0.1.0.zip'), '');
    writeFileSync(join(directory, 'notes.jar'), '');
    expect(packagesIn(directory, join(directory, 'missing'))).toEqual([
      join(directory, 'notes-0.1.0.zip'),
    ]);
  });
});
