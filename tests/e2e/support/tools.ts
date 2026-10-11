// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { INSTALLATION, KEYS, KEY_NAME, ROOT, WINDOWS } from './env.js';

/** The JDK tools of the Java that runs the tests (JAVA_HOME, or the one on the path). */
function jdkTool(name: string): string {
  const home = process.env.JAVA_HOME;
  const exe = WINDOWS ? `${name}.exe` : name;
  return home ? join(home, 'bin', exe) : exe;
}

/** The JAR of the plugin API in the test installation, which holds PackageSigningTool. */
export function kernelApiJar(): string {
  const lib = join(INSTALLATION, 'bin', 'kernel', 'lib', 'main');
  const jar = readdirSync(lib).find((name) => /mosaikit-kernel-api-.*\.jar$/.test(name));
  if (!jar) {
    throw new Error(`No mosaikit-kernel-api JAR in ${lib}`);
  }
  return join(lib, jar);
}

/** Runs PackageSigningTool (keygen, sign, verify, trust, index). */
export function signingTool(...args: string[]): string {
  return execFileSync(
    jdkTool('java'),
    ['-cp', kernelApiJar(), 'dev.mosaikit.kernel.api.signature.PackageSigningTool', ...args],
    { encoding: 'utf8' },
  );
}

/** Signs packages with the key of the tests. */
export function sign(...packages: string[]): void {
  signingTool('sign', join(KEYS, KEY_NAME), ...packages);
}

/** Writes and signs the index of a catalog directory with the key of the tests. */
export function index(directory: string): void {
  signingTool('index', join(KEYS, KEY_NAME), directory);
}

/** Zips the content of a directory, without a manifest, as plugin packages are. */
export function zip(directory: string, target: string): void {
  rmSync(target, { force: true });
  execFileSync(jdkTool('jar'), [
    '--create',
    '--no-manifest',
    '--file',
    target,
    '-C',
    directory,
    '.',
  ]);
}

/** Adds the files of a directory to an existing zip. */
export function addToZip(target: string, directory: string): void {
  execFileSync(jdkTool('jar'), [
    '--update',
    '--no-manifest',
    '--file',
    target,
    '-C',
    directory,
    '.',
  ]);
}

/** Unzips a package into a new directory. */
export function unzip(archive: string, directory: string): void {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  execFileSync(jdkTool('jar'), ['--extract', '--file', archive], { cwd: directory });
}

/** Runs the Maven wrapper of the repository. */
export function maven(pom: string, ...goals: string[]): string {
  const wrapper = join(ROOT, WINDOWS ? 'mvnw.cmd' : 'mvnw');
  return execFileSync(wrapper, ['-B', '-q', '-f', pom, ...goals], {
    encoding: 'utf8',
    shell: WINDOWS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Runs the plugin generator of the repository. */
export function createPlugin(...args: string[]): string {
  return execFileSync('node', [join(ROOT, 'sdk', 'create-plugin', 'dist', 'bin.js'), ...args], {
    encoding: 'utf8',
  });
}
