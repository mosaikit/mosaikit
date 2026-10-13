// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * `npm run check:pr`: the checks on which the CI of a pull request fails most often, in one command
 * on the workstation, before pushing. About two minutes once the kernel has been built.
 *
 *   npm run check:pr                    against origin/main
 *   npm run check:pr -- --base <ref>    against another branch
 *   npm run check:pr -- --no-java       without the kernel tests (no JDK at hand)
 *
 * It runs: lint, type check and the unit tests with the coverage thresholds (the job frontend, docs/
 * and the requirements included); DocumentationTest, the architecture tests and the other fast tests
 * of the kernel (the job backend), at the same time; the groups of the end-to-end tests; the
 * changelog fragment (the job changelog); semgrep on the changed files when it is installed (the job
 * sast). It does not replace the CI: the backend and end-to-end suites run there.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WINDOWS = process.platform === 'win32';

/** The kernel tests that take seconds and fail most often on a pull request. */
export const KERNEL_TESTS = [
  'DocumentationTest',
  'ApiTableTest',
  'KernelCoreArchitectureTest',
  'KernelApiArchitectureTest',
  'TestShardsTest',
];

/** The configuration of semgrep in the job sast of .github/workflows/ci.yml. */
export const SEMGREP_CONFIGS = ['p/java', 'p/typescript', 'p/owasp-top-ten'];

type Outcome = 'passed' | 'failed' | 'skipped';

interface Step {
  readonly name: string;
  readonly outcome: Outcome;
  readonly note?: string;
}

interface Options {
  readonly base: string;
  readonly java: boolean;
}

export function parseOptions(argv: readonly string[]): Options {
  let base = 'origin/main';
  let java = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base') {
      const value = argv[++i];
      if (!value) {
        throw new Error('--base needs a branch or commit, such as origin/main');
      }
      base = value;
    } else if (arg === '--no-java') {
      java = false;
    } else {
      throw new Error(`Unknown option ${String(arg)}: --base <ref>, --no-java`);
    }
  }
  return { base, java };
}

/** The changed files that semgrep scans in the job sast: Java, TypeScript and JavaScript sources. */
export function semgrepTargets(files: readonly string[]): string[] {
  return files.filter(
    (file) => /\.(java|ts|tsx|js|mjs|cjs)$/.test(file) && !file.endsWith('.d.ts'),
  );
}

/** Runs a command; its output goes to the terminal, or is returned when `capture` is set. */
function run(
  command: string,
  args: readonly string[],
  capture = false,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      shell: WINDOWS,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', (error) => {
      resolve({ code: 127, output: `${output}${error.message}\n` });
    });
    child.on('exit', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

function git(...args: string[]): string | undefined {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/**
 * Bash: on Windows the one of Git for Windows, next to git itself, as the bash.exe of the system is
 * the one of WSL.
 */
function bash(): string {
  if (!WINDOWS) {
    return 'bash';
  }
  const libexec = git('--exec-path'); // <Git>/mingw64/libexec/git-core
  const candidate = libexec ? join(libexec, '..', '..', '..', 'bin', 'bash.exe') : '';
  return candidate && existsSync(candidate) ? `"${candidate}"` : 'bash';
}

function heading(text: string): void {
  process.stdout.write(`\n=== ${text}\n`);
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseOptions(argv);
  const started = Date.now();
  const steps: Step[] = [];
  const base = git('merge-base', options.base, 'HEAD');

  // The kernel tests start at once, in the background: they take the longest.
  // By its full path: Windows may not look for commands in the current directory.
  const mvnw = join(ROOT, WINDOWS ? 'mvnw.cmd' : 'mvnw');
  const kernel = options.java
    ? run(
        mvnw,
        [
          '--batch-mode',
          '--no-transfer-progress',
          '-pl',
          'sdk/java,src/server',
          'test',
          '-Dskip.npm',
          `-Dtest=${KERNEL_TESTS.join(',')}`,
          '-Dsurefire.failIfNoSpecifiedTests=false',
          '-Dquarkus.http.test-port=0',
          '-Djacoco.skip=true',
        ],
        true,
      )
    : undefined;
  if (options.java) {
    process.stdout.write(`Kernel tests started in the background: ${KERNEL_TESTS.join(', ')}\n`);
  }

  for (const [name, args] of [
    ['lint', ['run', 'lint']],
    ['type check', ['run', 'typecheck']],
    ['unit tests with coverage (with docs/ and the requirements)', ['run', 'test:coverage']],
  ] as const) {
    heading(name);
    const { code } = await run('npm', args);
    steps.push({ name, outcome: code === 0 ? 'passed' : 'failed' });
  }

  heading('groups of the end-to-end tests');
  const groups = await run('node', ['tests/e2e/run.ts', '--check']);
  steps.push({ name: 'end-to-end groups', outcome: groups.code === 0 ? 'passed' : 'failed' });

  heading(`changelog fragment, against ${options.base}`);
  if (!base) {
    steps.push({
      name: 'changelog',
      outcome: 'skipped',
      note: `no merge base with ${options.base}: git fetch origin, or --base <ref>`,
    });
  } else {
    if (git('status', '--porcelain', '--', 'changelog.d', 'CHANGELOG.md')) {
      process.stdout.write('Note: only committed changes count, as in the CI.\n');
    }
    const changelog = await run(bash(), ['distribution/release/check-changelog.sh', base]);
    steps.push(
      changelog.code === 127
        ? { name: 'changelog', outcome: 'skipped', note: 'bash not found (Git Bash on Windows)' }
        : { name: 'changelog', outcome: changelog.code === 0 ? 'passed' : 'failed' },
    );
  }

  heading('semgrep on the changed files');
  const version = spawnSync('semgrep', ['--version'], { shell: WINDOWS, encoding: 'utf8' });
  if (version.status !== 0) {
    steps.push({
      name: 'semgrep',
      outcome: 'skipped',
      note: 'not installed (pipx install semgrep); the job sast runs it on every pull request',
    });
  } else {
    const changed = base ? (git('diff', '--name-only', `${base}...HEAD`) ?? '') : '';
    const targets = semgrepTargets(changed.split('\n')).filter((file) =>
      existsSync(join(ROOT, file)),
    );
    if (targets.length === 0) {
      steps.push({ name: 'semgrep', outcome: 'skipped', note: 'no changed source file' });
    } else {
      const configs = SEMGREP_CONFIGS.flatMap((config) => ['--config', config]);
      const scan = await run('semgrep', [
        'scan',
        ...configs,
        '--error',
        '--metrics',
        'off',
        ...targets,
      ]);
      steps.push({ name: 'semgrep', outcome: scan.code === 0 ? 'passed' : 'failed' });
    }
  }

  if (kernel) {
    heading(`kernel tests: ${KERNEL_TESTS.join(', ')}`);
    const { code, output } = await kernel;
    const lines = output.split(/\r?\n/);
    const relevant = lines.filter((line) =>
      /Tests run:|FAIL|ERROR\]|BUILD|does not follow|Rows that change|^[+-] \|/.test(line),
    );
    process.stdout.write(`${(code === 0 ? relevant.slice(-5) : relevant).join('\n')}\n`);
    if (code !== 0 && relevant.length === 0) {
      process.stdout.write(`${lines.slice(-40).join('\n')}\n`);
    }
    steps.push({ name: 'kernel tests', outcome: code === 0 ? 'passed' : 'failed' });
  } else {
    steps.push({ name: 'kernel tests', outcome: 'skipped', note: '--no-java' });
  }

  const seconds = Math.round((Date.now() - started) / 1000);
  heading(`check:pr in ${String(seconds)} s`);
  for (const step of steps) {
    process.stdout.write(
      `${step.outcome.padEnd(8)} ${step.name}${step.note ? ` (${step.note})` : ''}\n`,
    );
  }
  process.exitCode = steps.some((step) => step.outcome === 'failed') ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
