// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { CurrentUser, EventBus, FrontendExtension } from '@mosaikit/sdk';
import type { InitMessage } from './bridge-protocol.js';
import { ShellBridge } from './shell-bridge.js';

/** URL of the runtime of isolated frontends: a separate entry of the build (see vite.config.ts). */
const FRAME_RUNTIME = import.meta.env.DEV ? '/src/frame.ts' : '/frame.js';

/** Where the frame reads its runtime and extension modules from: the origin of the shell. */
export function frameDocument(origin: string, runtime: string = FRAME_RUNTIME): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${origin}/">
<style>html,body{margin:0;background:transparent;font:inherit;color:var(--mk-fg)}</style>
<script type="module" src="${origin}${runtime}"></script></head><body></body></html>`;
}

/** The design tokens of the shell, for the frame. */
function theme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const tokens: Record<string, string> = {};
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if (name.startsWith('--mk-')) {
      tokens[name] = style.getPropertyValue(name).trim();
    }
  }
  return tokens;
}

/**
 * Renders an app of an extension frontend that runs isolated (MK-014): a sandboxed iframe without
 * `allow-same-origin`, so that the extension cannot reach the page, the storage or the credentials of
 * the shell, and talks to it only through the {@link ShellBridge}.
 */
export class MkExtensionFrame extends HTMLElement {
  extension: FrontendExtension | undefined;
  element = '';
  user: CurrentUser | undefined;
  events: EventBus | undefined;
  request: ((path: string, init?: RequestInit) => Promise<Response>) | undefined;

  private frame: HTMLIFrameElement | undefined;
  private bridge: ShellBridge | undefined;
  private port: MessagePort | undefined;

  /**
   * The frame announces itself with a `ready` message that carries its end of a message channel;
   * from then on the shell and the frame talk only through that channel.
   */
  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const bridge = this.bridge;
    const port = event.ports[0];
    if (!bridge || this.port || !port || event.source !== this.frame?.contentWindow) {
      return;
    }
    if (!bridge.handle(event.data)) {
      return;
    }
    this.port = port;
    port.onmessage = (message: MessageEvent<unknown>) => {
      bridge.handle(message.data);
    };
    this.init();
  };

  connectedCallback(): void {
    const { extension, events, request, user } = this;
    if (!extension || !events || !request || !user) {
      return;
    }
    this.style.display = 'block';
    this.style.height = '100%';
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.setAttribute('title', extension.id);
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.style.cssText = 'border:0;width:100%;height:100%;min-height:70vh;display:block';
    frame.srcdoc = frameDocument(location.origin);
    this.bridge = new ShellBridge(extension, events, request, (message) => {
      this.port?.postMessage(message);
    });
    this.frame = frame;
    window.addEventListener('message', this.onMessage);
    this.replaceChildren(frame);
  }

  disconnectedCallback(): void {
    window.removeEventListener('message', this.onMessage);
    this.port?.close();
    this.port = undefined;
    this.bridge?.dispose();
    this.bridge = undefined;
    this.frame = undefined;
  }

  private init(): void {
    const extension = this.extension;
    const user = this.user;
    if (!extension || !user) {
      return;
    }
    const message: InitMessage = {
      mk: 1,
      type: 'init',
      extension: { id: extension.id, version: extension.version },
      entry: extension.entry,
      element: this.element,
      contributions: extension.contributions,
      user: { username: user.username, displayName: user.displayName, roles: [...user.roles] },
      locale: navigator.language,
      theme: theme(),
    };
    this.port?.postMessage(message);
  }
}

if (!customElements.get('mk-extension-frame')) {
  customElements.define('mk-extension-frame', MkExtensionFrame);
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-extension-frame': MkExtensionFrame;
  }
}
