// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { Launcher, locateInstallation, writeSettings, type Settings } from './installation.js';
import { freePort, startPostgres, type Database } from './postgres.js';
import { Signing, jdkTool } from './signing.js';
import { mails, startFakeSmtp, type FakeSmtp } from './smtp.js';

export interface Person {
  readonly user: string;
  readonly password: string;
  readonly name: string;
}

export interface Organization {
  readonly slug: string;
  readonly name: string;
}

export interface BenchOptions {
  /** Where the bench keeps the installation, the database, the mails and the logs. */
  readonly work: string;
  /** An installation to copy; by default MOSAIKIT_INSTALLATION or the snapshot of this version. */
  readonly installation?: string;
  /**
   * Extensions installed before the first start: packages (zips), signed with the key of the bench,
   * or extension directories, copied unsigned.
   */
  readonly extensions?: readonly string[];
  /**
   * Extensions offered by a signed catalog of the installation (catalog/), not installed: packages,
   * or extension directories, which the bench packs.
   */
  readonly catalog?: readonly string[];
  /** The port of the kernel; a free one by default. */
  readonly port?: number;
  readonly admin?: Person;
  readonly organization?: Organization;
  /** People who register in the organization and confirm their address, as people do. */
  readonly people?: readonly Person[];
  /** More settings of the installation, or settings that replace those of the bench. */
  readonly settings?: Settings;
  /** A database to use instead of an embedded PostgreSQL started for the bench. */
  readonly database?: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
  };
  /** A port for the control endpoint with which other processes restart the bench (Playwright). */
  readonly controlPort?: number;
  /** Called with the directory of the installation before its first start. */
  readonly beforeStart?: (installation: string) => void;
}

export const BENCH_ADMIN: Person = {
  user: 'admin',
  password: 'Bench-admin-2026',
  name: 'Platform administrator',
};
export const BENCH_ORGANIZATION: Organization = { slug: 'example', name: 'Example' };
export const BENCH_PEOPLE: readonly Person[] = [
  { user: 'member@example.test', password: 'Bench-member-2026', name: 'Member' },
  { user: 'colleague@example.test', password: 'Bench-colleague-2026', name: 'Colleague' },
];

/** What a running bench offers to the tests; also in the environment, see {@link fromEnvironment}. */
export interface BenchInfo {
  readonly baseUrl: string;
  readonly controlUrl?: string;
  readonly work: string;
  readonly installation: string;
  readonly mail: string;
  readonly admin: Person;
  readonly organization: Organization;
  readonly people: readonly Person[];
  /** The settings the installation started with, to change some of them at a restart. */
  readonly settings: Settings;
}

export const ENVIRONMENT = 'MOSAIKIT_BENCH';

/** A test installation with extensions, a database and a mail server of its own. */
export class Bench {
  private constructor(
    public info: BenchInfo,
    readonly signing: Signing,
    private readonly launcher: Launcher,
    private readonly settings: Settings,
    private readonly closers: (() => Promise<void>)[],
  ) {}

  static async start(options: BenchOptions): Promise<Bench> {
    const phase = phases();
    const source = await locateInstallation(options.installation);
    const work = resolve(options.work);
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    const installation = join(work, 'mosaikit');
    copyInstallation(source, installation);
    for (const directory of ['extensions', 'catalog', join('config', 'trusted-keys')]) {
      mkdirSync(join(installation, directory), { recursive: true });
    }
    const signing = new Signing(installation, join(work, 'keys'));
    mkdirSync(signing.keys, { recursive: true });
    signing.setUp();
    place(signing, options.extensions ?? [], join(installation, 'extensions'));
    if (options.catalog) {
      const catalog = join(installation, 'catalog');
      place(
        signing,
        options.catalog.map((extension) =>
          statSync(extension).isDirectory() ? pack(extension, join(work, 'packages')) : extension,
        ),
        catalog,
      );
      signing.index(catalog);
    }
    phase('installation and signed extensions');

    const closers: (() => Promise<void>)[] = [];
    let database = options.database;
    if (!database) {
      const embedded: Database = await startPostgres({
        // A directory of its own at each start: on Windows a worker of the cluster of a previous
        // run can outlive it and keep its shared memory, which a cluster in the same place refuses.
        directory: join(work, `postgres-${String(process.pid)}-${String(Date.now())}`),
        persistent: false,
      });
      closers.push(() => embedded.stop());
      database = { url: embedded.url, username: embedded.user, password: embedded.password };
    }
    const mail = join(work, 'mail');
    const smtpPort = await freePort();
    const smtp: FakeSmtp = await startFakeSmtp(smtpPort, mail);
    closers.push(() => smtp.close());
    phase('database and mail server');

    const port = options.port ?? (await freePort());
    const baseUrl = `http://localhost:${String(port)}`;
    const admin = options.admin ?? BENCH_ADMIN;
    const settings: Settings = {
      'quarkus.datasource.jdbc.url': database.url,
      'quarkus.datasource.username': database.username,
      'quarkus.datasource.password': database.password,
      'mosaikit.bootstrap.admin-password': admin.password,
      'quarkus.http.port': String(port),
      // The address the fake mail server listens on: on Linux "localhost" resolves to ::1 too, and
      // the mail client of Vert.x rotates over the addresses, so every other mail went to ::1, where
      // nobody listens, and failed the registration that sent it.
      'quarkus.mailer.host': '127.0.0.1',
      'quarkus.mailer.port': String(smtpPort),
      'quarkus.mailer.start-tls': 'DISABLED',
      // One connection for each mail: a pooled connection to the fake mail server once hung the
      // client, and a registration waited 22 s for its mail.
      'quarkus.mailer.keep-alive': 'false',
      // A master key of its own for each bench (MK-062), so that the store of credentials works
      // and extensions that read credentials can be tested; a setting of the caller replaces it.
      'mosaikit.secrets.master-key': randomBytes(32).toString('base64'),
      ...(options.catalog ? { 'mosaikit.marketplace.sources': 'catalog/' } : {}),
      ...options.settings,
    };
    writeSettings(installation, settings);
    options.beforeStart?.(installation);
    const launcher = new Launcher(installation, baseUrl, join(work, 'installation.log'));
    await launcher.start();
    closers.unshift(() => launcher.stop());
    phase('kernel ready');

    const info: BenchInfo = {
      baseUrl,
      work,
      installation,
      mail,
      admin,
      organization: options.organization ?? BENCH_ORGANIZATION,
      people: options.people ?? BENCH_PEOPLE,
      settings,
    };
    const bench = new Bench(info, signing, launcher, settings, closers);
    await bench.seed();
    phase('organization and people');
    if (options.controlPort !== undefined) {
      bench.info = { ...info, controlUrl: await bench.listen(options.controlPort) };
    }
    return bench;
  }

  /**
   * Restarts the installation, with settings that replace those of the bench when given; returns
   * the log of the restart, which says for example whether the kernel was rebuilt.
   */
  async restart(settings?: Settings): Promise<string> {
    const mark = this.launcher.logLength();
    await this.launcher.stop();
    writeSettings(this.info.installation, settings ?? this.settings);
    await this.launcher.start();
    return this.launcher.logSince(mark);
  }

  /** The settings the bench started with, to change some of them in {@link restart}. */
  get defaultSettings(): Settings {
    return { ...this.settings };
  }

  /** Puts the information of the bench in the environment, for the processes of the tests. */
  publish(): void {
    process.env[ENVIRONMENT] = JSON.stringify(this.info);
    writeFileSync(join(this.info.work, 'bench.json'), JSON.stringify(this.info, null, 2));
  }

  async stop(): Promise<void> {
    for (const close of this.closers) {
      await close();
    }
  }

  private async listen(port: number): Promise<string> {
    let restarting = Promise.resolve('');
    const control: Server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString()));
      request.on('end', () => {
        if (request.method !== 'POST' || request.url !== '/restart') {
          response.writeHead(404).end();
          return;
        }
        const { settings } = (body ? JSON.parse(body) : {}) as { settings?: Settings };
        restarting = restarting.then(() => this.restart(settings));
        restarting.then(
          (log) => response.writeHead(200, { 'Content-Type': 'text/plain' }).end(log),
          (error: unknown) => response.writeHead(500).end(String(error)),
        );
      });
    });
    await new Promise<void>((resolve) => control.listen(port, resolve));
    this.closers.push(
      () =>
        new Promise<void>((resolve) => {
          control.close(() => {
            resolve();
          });
        }),
    );
    return `http://localhost:${String(port)}`;
  }

  /** The organization of the bench and its people; those that exist are kept. */
  private async seed(): Promise<void> {
    const { baseUrl, admin, organization, people, mail } = this.info;
    const created = await fetch(`${baseUrl}/api/v1/organizations`, {
      method: 'POST',
      headers: { authorization: basic(admin), 'content-type': 'application/json' },
      body: JSON.stringify({ ...organization, selfRegistration: true }),
    });
    if (!created.ok && created.status !== 409) {
      throw new Error(`Cannot create the organization: ${String(created.status)}`);
    }
    for (const person of people) {
      await register(baseUrl, mail, organization.slug, person);
    }
  }
}

/**
 * Copies an installation, with hard links for the libraries of the kernel (bin/kernel/lib), which
 * no start changes: a new file would be scanned again by an antivirus when the kernel opens it,
 * which took 40 seconds on Windows, and the copy costs 95 MB. Copied when a link is not possible,
 * on another volume.
 */
export function copyInstallation(source: string, target: string): void {
  const libraries = join(source, 'bin', 'kernel', 'lib');
  cpSync(source, target, {
    recursive: true,
    filter: (path) => resolve(path) !== resolve(libraries),
  });
  linkTree(libraries, join(target, 'bin', 'kernel', 'lib'));
}

function linkTree(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      linkTree(from, to);
    } else {
      try {
        linkSync(from, to);
      } catch {
        copyFileSync(from, to);
      }
    }
  }
}

/** With MOSAIKIT_BENCH_DEBUG set, prints how long each phase of the start took. */
function phases(): (name: string) => void {
  let last = Date.now();
  return (name) => {
    if (process.env.MOSAIKIT_BENCH_DEBUG) {
      const now = Date.now();
      process.stderr.write(`[bench] ${name}: ${((now - last) / 1000).toFixed(1)} s\n`);
      last = now;
    }
  };
}

/** What an extension directory holds for the kernel; sources and build files stay out. */
const EXTENSION_FILES = new Set(['manifest.yaml', 'README.md', 'web', 'dist', 'db', 'lib', 'i18n']);

/**
 * Copies extensions into a directory: packages (zips) are signed with the key of the bench, extension
 * directories are copied unsigned, with only what the kernel reads.
 */
function place(signing: Signing, extensions: readonly string[], directory: string): void {
  const packages: string[] = [];
  for (const extension of extensions) {
    const copy = join(directory, basename(extension));
    if (statSync(extension).isDirectory()) {
      mkdirSync(copy, { recursive: true });
      for (const entry of readdirSync(extension).filter((name) => EXTENSION_FILES.has(name))) {
        cpSync(join(extension, entry), join(copy, entry), { recursive: true });
      }
    } else {
      copyFileSync(extension, copy);
      packages.push(copy);
    }
  }
  signing.sign(...packages);
}

/**
 * Packs an extension directory into `<directory name>-<version>.zip`, with only what the kernel reads,
 * as a published package is; the catalog of a marketplace offers packages, not directories.
 */
export function pack(extension: string, target: string): string {
  const version = /^version:\s*(\S+)/m.exec(
    readFileSync(join(extension, 'manifest.yaml'), 'utf8'),
  )?.[1];
  if (!version) {
    throw new Error(`No version in ${join(extension, 'manifest.yaml')}`);
  }
  mkdirSync(target, { recursive: true });
  const file = join(target, `${basename(extension)}-${version}.zip`);
  rmSync(file, { force: true });
  const parts = readdirSync(extension)
    .filter((name) => EXTENSION_FILES.has(name))
    .flatMap((name) => ['-C', extension, name]);
  execFileSync(jdkTool('jar'), ['--create', '--no-manifest', '--file', file, ...parts]);
  return file;
}

export const basic = (person: Person): string =>
  `Basic ${Buffer.from(`${person.user}:${person.password}`).toString('base64')}`;

/**
 * Registers a person in an organization that allows self-registration and confirms the address
 * with the link of the mail, as people do (MK-048). An existing person is kept.
 */
export async function register(
  baseUrl: string,
  mail: string,
  organization: string,
  person: Person,
): Promise<void> {
  const registered = await fetch(`${baseUrl}/api/v1/accounts/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organization,
      email: person.user,
      displayName: person.name,
      password: person.password,
    }),
  });
  if (!registered.ok && registered.status !== 409) {
    throw new Error(`Cannot register ${person.user}: ${String(registered.status)}`);
  }
  if (registered.status === 202) {
    const link = await confirmationLink(mail, person.user);
    const token = new URL(link).searchParams.get('confirm');
    const confirmed = await fetch(`${baseUrl}/api/v1/accounts/confirmations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!confirmed.ok) {
      throw new Error(`Cannot confirm ${person.user}: ${String(confirmed.status)}`);
    }
  }
}

/** The latest confirmation link sent to an address, waiting for it to arrive. */
export async function confirmationLink(mail: string, address: string, after = 0): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const received = mails(mail).filter((m) => m.to.includes(address));
    const latest = received.length > after ? received.at(-1) : undefined;
    const link = latest ? /https?:\/\/\S+\?confirm=[\w-]+/.exec(latest.raw)?.[0] : undefined;
    if (link) {
      return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No confirmation mail for ${address}`);
}

/** The bench that the global setup of the tests started, read from the environment. */
export function fromEnvironment(): BenchInfo {
  const value = process.env[ENVIRONMENT];
  if (!value) {
    throw new Error(`${ENVIRONMENT} is not set: start the bench in the global setup`);
  }
  return JSON.parse(value) as BenchInfo;
}
