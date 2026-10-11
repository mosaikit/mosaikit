// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';

/** A message received by the fake mail server. */
export interface Mail {
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  /** The raw message, headers and body. */
  readonly raw: string;
}

/** The first line of a stored mail: its recipients, as the client gave them (RCPT TO). */
const ENVELOPE = 'X-Envelope-To: ';

export interface FakeSmtp {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * A mail server for development and tests: it accepts every message over plain SMTP, without
 * authentication, and writes it to `directory` as `<n>.eml`, so that tests in other processes can
 * read it ({@link mails}). It delivers nothing.
 */
export async function startFakeSmtp(
  port: number,
  directory: string,
  onMail: (mail: Mail) => void = () => undefined,
): Promise<FakeSmtp> {
  mkdirSync(directory, { recursive: true });
  let count = readdirSync(directory).filter((name) => name.endsWith('.eml')).length;
  const sockets = new Set<Socket>();
  // The commands and the replies, without the content of the mails, to understand a lost mail.
  const transcript = join(directory, 'smtp.log');
  let connections = 0;

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    const connection = ++connections;
    const note = (text: string): void => {
      appendFileSync(transcript, `${new Date().toISOString()} #${String(connection)} ${text}\n`);
    };
    socket.on('close', () => {
      note('closed');
      sockets.delete(socket);
    });
    // A client that drops the connection (ECONNRESET) must not stop the server.
    socket.on('error', (error) => {
      note(`error ${error.message}`);
      socket.destroy();
    });
    socket.setEncoding('utf8');
    let buffer = '';
    let data: string[] | undefined;
    let from = '';
    let to: string[] = [];
    const reply = (line: string): void => {
      note(`< ${line}`);
      socket.write(`${line}\r\n`);
    };
    reply('220 localhost fake SMTP of Mosaikit');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') {
            const raw = data.join('\r\n');
            const subject = /^Subject: (.*)$/im.exec(raw)?.[1]?.trim() ?? '';
            const mail = { from, to, subject, raw: unfold(raw) };
            count += 1;
            // The recipients of the envelope go first: the To header may be written in many ways.
            // The file is renamed when complete, so that a reader never sees half of it.
            const file = join(directory, `${String(count).padStart(5, '0')}.eml`);
            writeFileSync(`${file}.part`, `${ENVELOPE}${to.join(',')}\r\n${raw}`);
            renameSync(`${file}.part`, file);
            note(`stored ${file} for ${to.join(',')}`);
            onMail(mail);
            data = undefined;
            reply('250 OK: queued');
          } else {
            data.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }
        note(`> ${line}`);
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'EHLO') {
          reply('250-localhost');
          reply('250 8BITMIME');
        } else if (command === 'HELO') {
          reply('250 localhost');
        } else if (command === 'MAIL') {
          from = /<([^>]*)>/.exec(line)?.[1] ?? '';
          to = [];
          reply('250 OK');
        } else if (command === 'RCPT') {
          to.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
          reply('250 OK');
        } else if (command === 'DATA') {
          data = [];
          reply('354 End data with <CR><LF>.<CR><LF>');
        } else if (command === 'QUIT') {
          reply('221 Bye');
          socket.end();
        } else if (command === 'RSET' || command === 'NOOP') {
          reply('250 OK');
        } else {
          reply('502 Command not implemented');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** The messages written by the fake mail server to `directory`, oldest first. */
export function mails(directory: string): Mail[] {
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith('.eml'));
  } catch {
    return [];
  }
  return names.sort().map((name) => {
    const raw = readFileSync(join(directory, name), 'utf8');
    const header = (field: string): string =>
      new RegExp(`^${field}: (.*)$`, 'im').exec(raw)?.[1]?.trim() ?? '';
    const envelope = raw.startsWith(ENVELOPE)
      ? raw.slice(ENVELOPE.length, raw.indexOf('\r\n'))
      : '';
    return {
      from: header('From'),
      to: (envelope || header('To'))
        .split(',')
        .map((address) => address.replace(/.*</, '').replace(/>.*/, '').trim()),
      subject: header('Subject'),
      raw: unfold(raw),
    };
  });
}

/**
 * The body as plain text: quoted-printable soft line breaks joined and `=XX` decoded, so that a
 * link can be found in it.
 */
function unfold(raw: string): string {
  // Only quoted-printable bodies: in a 7bit body "=88" is text, such as a part of a token.
  if (!/^Content-Transfer-Encoding:\s*quoted-printable/im.test(raw)) {
    return raw;
  }
  return raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
