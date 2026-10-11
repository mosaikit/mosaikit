// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { startPostgres } from '../../build/postgres.ts';
import { startFakeSmtp } from '../../build/smtp.ts';
import {
  ADMIN,
  ANNA,
  BASE_URL,
  CONTROL_PORT,
  MAIL,
  MARIO,
  MODEL_PORT,
  ORGANIZATION,
  SMTP_PORT,
  WORK,
} from './support/env.js';
import { startFakeModel } from './support/fake-model.js';
import { confirmationLink } from './support/mail.js';
import {
  configure,
  defaultSettings,
  logLength,
  logSince,
  prepare,
  start,
  stop,
  type Settings,
} from './support/installation.js';

/**
 * Prepares and starts a test installation from target/dist, a fake language model, and a control
 * endpoint with which the tests restart the installation (after installing plugins, or with other
 * settings): POST /restart {"settings": {...}} answers with the log of the restart.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  prepare();
  // Without E2E_DB_URL, a PostgreSQL of its own, deleted at the end (nothing to start by hand).
  const database = process.env.E2E_DB_URL
    ? undefined
    : await startPostgres({ directory: join(WORK, 'postgres'), persistent: false });
  if (database) {
    process.env.E2E_DB_URL = database.url;
    process.env.E2E_DB_USERNAME = database.user;
    process.env.E2E_DB_PASSWORD = database.password;
  }
  configure(defaultSettings());
  const model = await startFakeModel(MODEL_PORT);
  rmSync(MAIL, { recursive: true, force: true });
  const smtp = await startFakeSmtp(SMTP_PORT, MAIL);
  await start();
  await seed();

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
      restarting = restarting.then(async () => {
        const mark = logLength();
        await stop();
        configure(settings ?? defaultSettings());
        await start();
        return logSince(mark);
      });
      restarting.then(
        (log) => response.writeHead(200, { 'Content-Type': 'text/plain' }).end(log),
        (error: unknown) => response.writeHead(500).end(String(error)),
      );
    });
  });
  await new Promise<void>((resolve) => control.listen(CONTROL_PORT, resolve));

  return async () => {
    await stop();
    control.close();
    model.close();
    await smtp.close();
    await database?.stop();
  };
}

/** The organization of the tests and two of its people; existing ones are kept. */
async function seed(): Promise<void> {
  const admin = `Basic ${Buffer.from(`${ADMIN.user}:${ADMIN.password}`).toString('base64')}`;
  const created = await fetch(`${BASE_URL}/api/v1/organizations`, {
    method: 'POST',
    headers: { authorization: admin, 'content-type': 'application/json' },
    body: JSON.stringify({ ...ORGANIZATION, selfRegistration: true }),
  });
  if (!created.ok && created.status !== 409) {
    throw new Error(
      `Cannot create the organization: ${String(created.status)} ${await created.text()}`,
    );
  }
  for (const person of [MARIO, ANNA]) {
    const registered = await fetch(`${BASE_URL}/api/v1/accounts/registrations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organization: ORGANIZATION.slug,
        email: person.user,
        displayName: person.name,
        password: person.password,
      }),
    });
    if (!registered.ok && registered.status !== 409) {
      throw new Error(`Cannot register ${person.user}: ${String(registered.status)}`);
    }
    // They confirm their address with the link of the mail, as people do (MK-048).
    if (registered.status === 202) {
      const token = new URL(await confirmationLink(person.user)).searchParams.get('confirm');
      const confirmed = await fetch(`${BASE_URL}/api/v1/accounts/confirmations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!confirmed.ok) {
        throw new Error(`Cannot confirm ${person.user}: ${String(confirmed.status)}`);
      }
    }
  }
}
