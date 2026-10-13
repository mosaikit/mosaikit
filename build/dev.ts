// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * `npm run dev`: the kernel and the shell in development mode (live reload of Java, hot module
 * replacement of the UI), on a PostgreSQL that starts and stops with it, with a fake language model
 * for the assistant and sample data ready: nothing to install or start by hand but Java and Node.
 *
 *   npm run dev                  # http://localhost:8080, admin / admin-dev-only
 *   npm run dev -- --reset       # start again from an empty database
 *
 * The database lives in .dev/postgres and survives restarts.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeModel } from '../tests/e2e/support/fake-model.ts';
import { startFakeSmtp } from '../sdk/testing/src/smtp.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WINDOWS = process.platform === 'win32';
const PORT = Number(process.env.MOSAIKIT_DEV_PORT ?? '8080');
const DB_PORT = Number(process.env.MOSAIKIT_DEV_DB_PORT ?? '54330');
const MODEL_PORT = Number(process.env.MOSAIKIT_DEV_MODEL_PORT ?? '18092');
const SMTP_PORT = Number(process.env.MOSAIKIT_DEV_SMTP_PORT ?? '18025');
/** The latest confirmation link sent to each address, read by the fake mail server. */
const links = new Map<string, string>();
const ADMIN = { user: 'admin', password: 'admin-dev-only' };
const PEOPLE = [
  { email: 'mario.rossi@example.org', name: 'Mario Rossi' },
  { email: 'anna.bianchi@example.org', name: 'Anna Bianchi' },
];
const PEOPLE_PASSWORD = 'dev-password-2026';
const ORGANIZATION = { slug: 'demo', name: 'Demo' };

const mvnw = join(ROOT, WINDOWS ? 'mvnw.cmd' : 'mvnw');
const log = (message: string): void => {
  process.stdout.write(`\x1b[36m[dev]\x1b[0m ${message}\n`);
};

/**
 * Builds the extension API (`sdk/java`) at every start. The dev mode of the kernel takes its classes
 * from `sdk/java/target/classes` of this checkout, which a `git pull` leaves stale: a kernel with
 * new code would then run on the old API (NoSuchMethodError). It takes a few seconds.
 */
function buildExtensionApi(): void {
  log('building the extension API…');
  const built = spawnSync(
    mvnw,
    [
      '-B',
      '-q',
      'install',
      '-DskipTests',
      '-Dskip.npm',
      '-Dspotless.apply.skip=true',
      '-pl',
      'sdk/java',
      '-am',
    ],
    {
      cwd: ROOT,
      stdio: 'inherit',
      shell: WINDOWS,
    },
  );
  if (built.status !== 0) {
    throw new Error('The build of the extension API failed');
  }
}

/** The token of the confirmation link sent to an address, once the mail arrived. */
async function linkFor(email: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const link = links.get(email);
    if (link) {
      return new URL(link).searchParams.get('confirm') ?? '';
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No confirmation mail for ${email}`);
}

async function seed(): Promise<void> {
  const base = `http://localhost:${String(PORT)}`;
  for (;;) {
    try {
      if ((await fetch(`${base}/q/health/ready`)).ok) {
        break;
      }
    } catch {
      // not yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const admin = `Basic ${Buffer.from(`${ADMIN.user}:${ADMIN.password}`).toString('base64')}`;
  await fetch(`${base}/api/v1/organizations`, {
    method: 'POST',
    headers: { authorization: admin, 'content-type': 'application/json' },
    body: JSON.stringify({ ...ORGANIZATION, selfRegistration: true }),
  });
  for (const person of PEOPLE) {
    const registered = await fetch(`${base}/api/v1/accounts/registrations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organization: ORGANIZATION.slug,
        email: person.email,
        displayName: person.name,
        password: PEOPLE_PASSWORD,
      }),
    });
    // The demo people confirm their address at once, with the link of the fake mail server.
    if (registered.status === 202) {
      const token = await linkFor(person.email);
      await fetch(`${base}/api/v1/accounts/confirmations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    }
  }
  log(`ready on ${base}`);
  log(`  admin / ${ADMIN.password} (platform administrator)`);
  for (const person of PEOPLE) {
    log(`  ${person.email} / ${PEOPLE_PASSWORD} (organization "${ORGANIZATION.slug}")`);
  }
}

/**
 * Stops with a clear message when the npm packages are missing or older than package-lock.json,
 * as after a git pull that changed the dependencies.
 */
function checkPackages(): void {
  const installed = join(ROOT, 'node_modules', '.package-lock.json');
  if (
    !existsSync(installed) ||
    statSync(installed).mtimeMs < statSync(join(ROOT, 'package-lock.json')).mtimeMs
  ) {
    log(
      'the npm packages are missing or older than package-lock.json: run "npm ci", then "npm run dev"',
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  checkPackages();
  // Imported only now: it needs the package embedded-postgres.
  const { startPostgres } = await import('../sdk/testing/src/postgres.ts');
  const directory = join(ROOT, '.dev', 'postgres');
  if (process.argv.includes('--reset')) {
    rmSync(directory, { recursive: true, force: true });
    log('database reset');
  }
  buildExtensionApi();
  const database = await startPostgres({ directory, persistent: true, port: DB_PORT });
  log(`PostgreSQL on 127.0.0.1:${String(database.port)} (.dev/postgres)`);
  const model = await startFakeModel(MODEL_PORT);
  log(`fake language model on http://localhost:${String(MODEL_PORT)}/v1`);
  // Mails are not delivered: their links are printed here (and kept in .dev/mail).
  const smtp = await startFakeSmtp(SMTP_PORT, join(ROOT, '.dev', 'mail'), (mail) => {
    const link = /https?:\/\/\S+\?confirm=[\w-]+/.exec(mail.raw)?.[0];
    for (const address of mail.to) {
      if (link) {
        links.set(address, link);
      }
      log(`mail to ${address}: "${mail.subject}"${link ? ` ${link}` : ''}`);
    }
  });
  log(`fake mail server on localhost:${String(SMTP_PORT)}`);

  const kernel = spawn(
    mvnw,
    [
      '-pl',
      'src/server',
      'quarkus:dev',
      `-Dquarkus.http.port=${String(PORT)}`,
      `-Dquarkus.datasource.jdbc.url=${database.url}`,
      `-Dquarkus.datasource.username=${database.user}`,
      `-Dquarkus.datasource.password=${database.password}`,
      `-Dmosaikit.assistant.url=http://localhost:${String(MODEL_PORT)}/v1`,
      '-Dmosaikit.assistant.model=dev-fake-model',
      '-Dquarkus.mailer.host=localhost',
      `-Dquarkus.mailer.port=${String(SMTP_PORT)}`,
      '-Dquarkus.mailer.start-tls=DISABLED',
    ],
    { cwd: ROOT, stdio: 'inherit', shell: WINDOWS },
  );
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    // On Windows the kernel runs under cmd: stop the whole tree, or its java would stay.
    if (WINDOWS && kernel.pid !== undefined && kernel.exitCode === null) {
      spawnSync('taskkill', ['/pid', String(kernel.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      kernel.kill();
    }
    model.close();
    await smtp.close();
    await database.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  kernel.on('exit', () => void stop());
  await seed();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
