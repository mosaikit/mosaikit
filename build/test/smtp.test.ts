// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mails } from '../smtp.ts';

const LINK = /https?:\/\/\S+\?confirm=[\w-]+/;

function stored(body: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'mosaikit-mail-'));
  writeFileSync(join(directory, '00001.eml'), body);
  return directory;
}

describe('the fake mail server (MK-048)', () => {
  it('keeps 7bit bodies as they are: =88 is a part of the token, not a byte', () => {
    const token = '880uQv_lGcT27mf7Oc8o4tyqTF6dQqHWwZFzVOyT2es';
    const directory = stored(
      [
        'X-Envelope-To: mario.rossi@comune.test',
        'Subject: Confirm your email address',
        'To: mario.rossi@comune.test',
        'Content-Transfer-Encoding: 7bit',
        '',
        `http://localhost:8181/?confirm=${token}`,
      ].join('\r\n'),
    );

    const [mail] = mails(directory);
    expect(mail?.to).toEqual(['mario.rossi@comune.test']);
    expect(LINK.exec(mail?.raw ?? '')?.[0]).toBe(`http://localhost:8181/?confirm=${token}`);
  });

  it('decodes quoted-printable bodies, soft line breaks included', () => {
    const directory = stored(
      [
        'X-Envelope-To: anna@comune.test',
        'Subject: Confirm',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'http://localhost:8181/?confirm=3DAbC=',
        'dEf',
      ].join('\r\n'),
    );

    const [mail] = mails(directory);
    expect(mail?.to).toEqual(['anna@comune.test']);
    expect(LINK.exec(mail?.raw ?? '')?.[0]).toBe('http://localhost:8181/?confirm=AbCdEf');
  });
});
