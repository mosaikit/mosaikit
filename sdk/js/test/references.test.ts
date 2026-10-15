// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PresenceStore,
  REFERENCE_PLACEHOLDER_TAG,
  RESOLVE_REFERENCES_PATH,
  defineReferencePlaceholder,
  referencePlaceholderHtml,
  referencePlaceholderText,
  resolveReferences,
  watchReferences,
  type ReferencePlaceholderElement,
  type ResolvedReference,
} from '../src/index.js';

const MAPS = 'org.example.ext.maps';
const MAP = { extension: MAPS, type: 'map', id: 'm1' };
const AVAILABLE: ResolvedReference = {
  ...MAP,
  status: 'available',
  title: 'Rivers',
  link: '/app/maps/m1',
};
const ABSENT: ResolvedReference = { ...MAP, status: 'extension-absent' };

function answering(...answers: ResolvedReference[][]) {
  const queue = [...answers];
  return vi.fn((_path: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(queue.shift() ?? []), { status: 200 })),
  );
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('MK-135 References between resources of different extensions', () => {
  it('asks the kernel to resolve references, in their order, and changes nothing', async () => {
    const fetch = answering([AVAILABLE, { ...MAP, id: 'm2', status: 'deleted' }]);

    const resolved = await resolveReferences({ fetch }, [
      { ...MAP, extra: 'kept by the extension' } as typeof MAP,
      { ...MAP, id: 'm2' },
    ]);

    expect(resolved.map((reference) => reference.status)).toEqual(['available', 'deleted']);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, init] = fetch.mock.calls[0] ?? [];
    expect(path).toBe(RESOLVE_REFERENCES_PATH);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual([MAP, { ...MAP, id: 'm2' }]);
    expect(await resolveReferences({ fetch }, [])).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails when the kernel refuses', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 400 })));
    await expect(resolveReferences({ fetch }, [MAP])).rejects.toThrow('(400)');
  });

  it('resolves again, without a reload, when the extension of a reference comes back', async () => {
    const extensions = new PresenceStore([]);
    const fetch = answering([ABSENT], [AVAILABLE], [ABSENT]);
    const seen: string[] = [];

    const stop = watchReferences({ fetch, extensions }, [MAP], (resolved) => {
      seen.push(resolved[0]?.status ?? '');
    });
    await settle();
    expect(seen).toEqual(['extension-absent']);

    // Another extension changes nothing.
    extensions.apply({
      extension: 'org.example.ext.other',
      active: true,
      version: '1.0.0',
      reason: 'installed',
    });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);

    extensions.apply({ extension: MAPS, active: true, version: '1.0.0', reason: 'enabled' });
    await settle();
    expect(seen).toEqual(['extension-absent', 'available']);

    extensions.apply({ extension: MAPS, active: false, version: '1.0.0', reason: 'disabled' });
    await settle();
    expect(seen).toEqual(['extension-absent', 'available', 'extension-absent']);

    stop();
    extensions.apply({ extension: MAPS, active: true, version: '1.0.0', reason: 'enabled' });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('drops an answer older than one already delivered, and reports failures', async () => {
    const extensions = new PresenceStore([]);
    let release: (response: Response) => void = () => undefined;
    const slow = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetch = vi
      .fn<(path: string, init?: RequestInit) => Promise<Response>>()
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce(new Response(JSON.stringify([AVAILABLE]), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const seen: string[] = [];
    const errors: unknown[] = [];

    const stop = watchReferences(
      { fetch, extensions },
      [MAP],
      (resolved) => seen.push(resolved[0]?.status ?? ''),
      (error) => errors.push(error),
    );
    extensions.apply({ extension: MAPS, active: true, version: '1.0.0', reason: 'enabled' });
    await settle();
    release(new Response(JSON.stringify([ABSENT]), { status: 200 }));
    await settle();
    expect(seen).toEqual(['available']);

    extensions.apply({ extension: MAPS, active: false, version: '1.0.0', reason: 'disabled' });
    await settle();
    expect(errors).toHaveLength(1);
    stop();
  });

  it('logs failures by default', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })));
    const stop = watchReferences(
      { fetch, extensions: new PresenceStore([]) },
      [MAP],
      () => undefined,
    );
    await settle();
    expect(error).toHaveBeenCalled();
    stop();
    error.mockRestore();
  });
});

describe('MK-135 The placeholder of a reference that is not available', () => {
  it('says what is missing and why, in English and Italian', () => {
    expect(referencePlaceholderText(AVAILABLE, 'Rivers map')).toBeUndefined();
    expect(referencePlaceholderText(ABSENT, 'Rivers map')).toEqual({
      title: 'Not available: Rivers map',
      detail: 'The extension that provides it is not active in this organization.',
    });
    expect(referencePlaceholderText({ status: 'deleted' }, undefined, 'en-GB')).toEqual({
      title: 'This content is not available',
      detail: 'It was deleted.',
    });
    expect(referencePlaceholderText({ status: 'forbidden' }, ' ', 'fr')?.detail).toBe(
      'You do not have access to it.',
    );
    expect(referencePlaceholderText(ABSENT, 'Mappa dei fiumi', 'it-IT')).toEqual({
      title: 'Non disponibile: Mappa dei fiumi',
      detail: "L'estensione che lo fornisce non è attiva in questa organizzazione.",
    });
    expect(referencePlaceholderText({ status: 'deleted' }, undefined, 'it')?.title).toBe(
      'Questo contenuto non è disponibile',
    );
    expect(referencePlaceholderText({ status: 'forbidden' }, undefined, 'it')?.detail).toBe(
      'Non hai accesso a questo contenuto.',
    );
  });

  it('tells administrators which extension to install or turn on', () => {
    const missing = (action: 'install' | 'restart' | 'repair' | 'turn-on', name?: string) =>
      ({
        status: 'extension-absent',
        missing: { extension: MAPS, action, ...(name ? { name } : {}) },
      }) as const;

    expect(referencePlaceholderText(missing('turn-on', 'Maps'), 'Rivers')?.action).toBe(
      `Turn on the extension Maps (${MAPS}) in the apps of the organization.`,
    );
    expect(referencePlaceholderText(missing('install'))?.action).toBe(
      `An administrator of the installation can install the extension ${MAPS}.`,
    );
    expect(referencePlaceholderText(missing('restart', 'Maps'))?.action).toContain('restarts');
    expect(referencePlaceholderText(missing('repair', 'Maps'))?.action).toContain('cannot run');
    expect(referencePlaceholderText(missing('turn-on', 'Maps'), undefined, 'it')?.action).toBe(
      `Attiva l'estensione Maps (${MAPS}) nelle app dell'organizzazione.`,
    );
    expect(referencePlaceholderText(missing('install'), undefined, 'it')?.action).toContain(
      'installare',
    );
    expect(referencePlaceholderText(missing('restart'), undefined, 'it')?.action).toContain(
      'riavvio',
    );
    expect(referencePlaceholderText(missing('repair'), undefined, 'it')?.action).toContain(
      'non può funzionare',
    );
    // Only for an absent extension.
    expect(
      referencePlaceholderText({ status: 'deleted', missing: missing('install').missing })?.action,
    ).toBeUndefined();
  });

  it('renders the same note for every extension, with escaped texts', () => {
    expect(referencePlaceholderHtml(undefined)).toBe('');
    const html = referencePlaceholderHtml({
      title: 'Not available: <b>"Rivers" & lakes\'</b>',
      detail: 'It was deleted.',
      action: 'Turn on <Maps>.',
    });
    expect(html).toContain('role="note"');
    expect(html).toContain('Not available: &lt;b&gt;&quot;Rivers&quot; &amp; lakes&#39;&lt;/b&gt;');
    expect(html).toContain('<p class="action" part="action">Turn on &lt;Maps&gt;.</p>');
    expect(referencePlaceholderHtml({ title: 'T', detail: 'D' })).not.toContain('action');
  });
});

describe('MK-135 The element <mk-reference-placeholder>', () => {
  class FakeElement {
    shadowRoot: { innerHTML: string } | null = null;
    hidden = false;
    private readonly attributes = new Map<string, string>();
    attachShadow(): { innerHTML: string } {
      this.shadowRoot = { innerHTML: '' };
      return this.shadowRoot;
    }
    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }
    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
      (this as unknown as { attributeChangedCallback(): void }).attributeChangedCallback();
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is defined once, and shows the placeholder only while the reference is not available', () => {
    vi.stubGlobal('HTMLElement', FakeElement);
    const defined = new Map<string, CustomElementConstructor>();
    const registry = {
      get: (name: string) => defined.get(name),
      define: vi.fn((name: string, constructor: CustomElementConstructor) => {
        defined.set(name, constructor);
      }),
    };

    defineReferencePlaceholder(registry);
    defineReferencePlaceholder(registry);
    expect(registry.define).toHaveBeenCalledTimes(1);

    const Element = defined.get(REFERENCE_PLACEHOLDER_TAG) as unknown as new () => FakeElement &
      ReferencePlaceholderElement & { connectedCallback(): void };
    const element = new Element();
    element.connectedCallback();
    expect(element.hidden).toBe(true);
    expect(element.shadowRoot?.innerHTML).toBe('');

    element.setAttribute('label', 'Rivers map');
    element.reference = ABSENT;
    expect(element.reference).toBe(ABSENT);
    expect(element.hidden).toBe(false);
    expect(element.shadowRoot?.innerHTML).toContain('Not available: Rivers map');

    element.setAttribute('locale', 'it');
    expect(element.shadowRoot?.innerHTML).toContain('Non disponibile: Rivers map');

    element.reference = AVAILABLE;
    expect(element.hidden).toBe(true);
    expect(element.shadowRoot?.innerHTML).toBe('');
  });

  it('speaks the language of the page without the attribute', () => {
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('document', { documentElement: { lang: 'it' } });
    const defined = new Map<string, CustomElementConstructor>();
    defineReferencePlaceholder({
      get: (name) => defined.get(name),
      define: (name, constructor) => {
        defined.set(name, constructor);
      },
    });
    const Element = defined.get(REFERENCE_PLACEHOLDER_TAG) as unknown as new () => FakeElement &
      ReferencePlaceholderElement;
    const element = new Element();
    element.reference = { status: 'deleted' };
    expect(element.shadowRoot?.innerHTML).toContain('È stato eliminato.');
  });
});
