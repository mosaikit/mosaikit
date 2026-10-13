// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { createServer, type Server } from 'node:http';

/**
 * A language model behind the chat completions API of OpenAI, for the tests of the assistant
 * (MK-024): it answers a few Italian requests about activities with the tools that the kernel
 * offers, always the same way, so that the tests check the kernel and the shell and not a model.
 *
 * - "Quali attività sono ancora aperte?": calls the list tool, then names the open activities;
 * - 'Completa l'attività "<title>"': lists, then calls the complete tool with the id of that
 *   activity; with "usando il titolo" it passes the title as the id, as a weak model would;
 * - 'Crea l'attività "<title>"': calls the create tool.
 */

interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
}

interface ChatRequest {
  messages: ChatMessage[];
  tools?: { function: { name: string } }[];
}

function toolCall(name: string, args: Record<string, unknown>): unknown {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: `call-${String(Date.now())}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

const text = (content: string): unknown => ({ role: 'assistant', content });

interface Activity {
  id: string;
  title: string;
  done: boolean;
}

/** The activities in the result of a tool, whatever JSON wraps them (strings of JSON included). */
function activities(content: string): Activity[] {
  const found: Activity[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          visit(JSON.parse(trimmed));
        } catch {
          // not JSON
        }
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      if (typeof record.id === 'string' && typeof record.title === 'string') {
        found.push({ id: record.id, title: record.title, done: record.done === true });
      }
      Object.values(record).forEach(visit);
    }
  };
  visit(content);
  return found;
}

/** The next message of the model for a conversation. */
export function reply(request: ChatRequest): unknown {
  const tool = (suffix: string): string =>
    request.tools?.map((t) => t.function.name).find((name) => name.endsWith(suffix)) ?? suffix;
  const question = [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const lastUser = request.messages.findLastIndex((m) => m.role === 'user');
  const results = request.messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  const last = results.at(-1)?.content ?? '';

  if (/aperte/i.test(question)) {
    if (results.length === 0) {
      return toolCall(tool('__list-activities'), {});
    }
    const open = activities(last).filter((a) => !a.done);
    return text(`Le attività aperte sono: ${open.map((a) => `"${a.title}"`).join(', ')}.`);
  }
  const complete = /complet\w* l'attività "([^"]+)"/i.exec(question);
  if (complete) {
    const title = complete[1] ?? '';
    if (results.length === 0) {
      return toolCall(tool('__list-activities'), {});
    }
    if (results.length === 1) {
      const found = activities(last).find((a) => a.title === title);
      const id = /usando il titolo/i.test(question) || !found ? title : found.id;
      return toolCall(tool('__complete-activity'), { id });
    }
    return text(`Risposta dello strumento: ${last}`);
  }
  const create = /crea l'attività "([^"]+)"/i.exec(question);
  if (create) {
    if (results.length === 0) {
      return toolCall(tool('__create-activity'), { title: create[1] ?? '' });
    }
    return text(`Risposta dello strumento: ${last}`);
  }
  return text('Non so rispondere a questa domanda.');
}

export function startFakeModel(port: number): Promise<Server> {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
        response.writeHead(404).end();
        return;
      }
      const message = reply(JSON.parse(body) as ChatRequest);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ index: 0, message, finish_reason: 'stop' }] }));
    });
  });
  return new Promise((resolve) =>
    server.listen(port, () => {
      resolve(server);
    }),
  );
}
