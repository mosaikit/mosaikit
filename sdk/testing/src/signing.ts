// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const WINDOWS = process.platform === 'win32';

/** A JDK tool of the Java that runs the bench: JAVA_HOME, or the one on the path. */
export function jdkTool(name: string): string {
  const home = process.env.JAVA_HOME;
  const exe = WINDOWS ? `${name}.exe` : name;
  return home ? join(home, 'bin', exe) : exe;
}

/** The JAR of the extension API in an installation, which holds PackageSigningTool. */
export function kernelApiJar(installation: string): string {
  const lib = join(installation, 'bin', 'kernel', 'lib', 'main');
  const jar = readdirSync(lib).find((name) => /mosaikit-kernel-api-.*\.jar$/.test(name));
  if (!jar) {
    throw new Error(`No mosaikit-kernel-api JAR in ${lib}`);
  }
  return join(lib, jar);
}

/**
 * The signing tool of the extension packages (MK-013) of an installation, with a key of its own in
 * `keys`: keygen, sign, index, trust.
 */
export class Signing {
  constructor(
    private readonly installation: string,
    readonly keys: string,
    readonly keyName = 'bench',
  ) {}

  run(...args: string[]): string {
    return execFileSync(
      jdkTool('java'),
      [
        '-cp',
        kernelApiJar(this.installation),
        'dev.mosaikit.kernel.api.signature.PackageSigningTool',
        ...args,
      ],
      { encoding: 'utf8' },
    );
  }

  /** Creates the key and makes the installation trust it. */
  setUp(): void {
    this.run('keygen', this.keys, this.keyName);
    this.run(
      'trust',
      join(this.keys, this.keyName),
      join(this.installation, 'config', 'trusted-keys'),
    );
  }

  /** Signs packages with the key of the bench. */
  sign(...packages: string[]): void {
    if (packages.length > 0) {
      this.run('sign', join(this.keys, this.keyName), ...packages);
    }
  }

  /** Writes and signs the index of a catalog directory. */
  index(directory: string): void {
    this.run('index', join(this.keys, this.keyName), directory);
  }
}
