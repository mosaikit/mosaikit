// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { FederatedSignIn, pkceChallenge, type KeyValueStore } from '../src/federation.js';

const ISSUER = 'https://auth.example.org/realms/acme';
const federation = { issuer: ISSUER, clientId: 'mosaikit' };

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

class MapStore implements KeyValueStore {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function realm() {
  return vi.fn<(input: string, init?: RequestInit) => Promise<Response>>((input) => {
    if (input.endsWith('/.well-known/openid-configuration')) {
      return Promise.resolve(
        json({
          authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
          token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
          end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
        }),
      );
    }
    return Promise.resolve(
      json({ access_token: 'access', refresh_token: 'refresh', id_token: 'id', expires_in: 60 }),
    );
  });
}

describe('FederatedSignIn (MK-012)', () => {
  it('computes the S256 challenge of RFC 7636', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('sends the person to the realm with PKCE and exchanges the code', async () => {
    const fetchMock = realm();
    const storage = new MapStore();
    const signIn = new FederatedSignIn(fetchMock, storage);

    const url = new URL(
      await signIn.begin(federation, 'ada@acme.com', 'https://acme.example.org/'),
    );
    expect(url.origin + url.pathname).toBe(`${ISSUER}/protocol/openid-connect/auth`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_id')).toBe('mosaikit');
    expect(url.searchParams.get('login_hint')).toBe('ada@acme.com');
    const state = url.searchParams.get('state') ?? '';
    const pending = JSON.parse(storage.getItem('mosaikit.federated-sign-in') ?? '{}') as {
      verifier: string;
    };
    expect(url.searchParams.get('code_challenge')).toBe(await pkceChallenge(pending.verifier));

    const result = await signIn.complete(
      new URL(`https://acme.example.org/?code=the-code&state=${state}`),
    );

    expect(result?.tokens.accessToken).toBe('access');
    expect(result?.federation).toEqual(federation);
    const body = new URLSearchParams(fetchMock.mock.calls.at(-1)?.[1]?.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe(pending.verifier);
    expect(storage.values.size).toBe(0);
  });

  it('refuses an answer with another state and ignores ordinary pages', async () => {
    const storage = new MapStore();
    const signIn = new FederatedSignIn(realm(), storage);
    await signIn.begin(federation, '', 'https://acme.example.org/');

    expect(await signIn.complete(new URL('https://acme.example.org/app/notes'))).toBeUndefined();
    await expect(
      signIn.complete(new URL('https://acme.example.org/?code=x&state=forged')),
    ).rejects.toThrow('does not match');
  });

  it('builds the sign-out address of the realm', async () => {
    const signIn = new FederatedSignIn(realm(), new MapStore());

    const url = new URL(
      (await signIn.signOutUrl(federation, 'id', 'https://acme.example.org/')) ?? '',
    );

    expect(url.pathname).toBe('/realms/acme/protocol/openid-connect/logout');
    expect(url.searchParams.get('id_token_hint')).toBe('id');
  });

  it('reports a sign-in cancelled at the realm', async () => {
    const storage = new MapStore();
    const signIn = new FederatedSignIn(realm(), storage);
    const url = new URL(await signIn.begin(federation, '', 'https://acme.example.org/'));
    const state = url.searchParams.get('state') ?? '';

    await expect(
      signIn.complete(
        new URL(
          `https://acme.example.org/?error=access_denied&error_description=Cancelled&state=${state}`,
        ),
      ),
    ).rejects.toThrow('Cancelled');
    expect(storage.values.size).toBe(0);
  });

  it('reports a code refused by the realm', async () => {
    const fetchMock = realm();
    const storage = new MapStore();
    const signIn = new FederatedSignIn(fetchMock, storage);
    const url = new URL(await signIn.begin(federation, '', 'https://acme.example.org/'));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));

    await expect(
      signIn.complete(
        new URL(`https://acme.example.org/?code=x&state=${url.searchParams.get('state') ?? ''}`),
      ),
    ).rejects.toThrow('refused');
  });

  it('reports an unreachable realm and retries its discovery later', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    );
    const signIn = new FederatedSignIn(fetchMock, new MapStore());

    await expect(signIn.begin(federation, '', 'https://acme.example.org/')).rejects.toThrow(
      'cannot be reached',
    );
    await expect(signIn.begin(federation, '', 'https://acme.example.org/')).rejects.toThrow(
      'cannot be reached',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes the tokens and defaults their lifetime', async () => {
    const fetchMock = realm();
    const signIn = new FederatedSignIn(fetchMock, new MapStore());
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        input.endsWith('/.well-known/openid-configuration')
          ? json({ authorization_endpoint: 'https://a/auth', token_endpoint: 'https://a/token' })
          : json({ access_token: 'new' }),
      ),
    );

    const tokens = await signIn.refresh(federation, 'refresh');

    expect(tokens).toEqual({
      accessToken: 'new',
      refreshToken: undefined,
      idToken: undefined,
      expiresIn: 300,
    });
    expect(
      await signIn.signOutUrl(federation, undefined, 'https://acme.example.org/'),
    ).toBeUndefined();
  });
});
