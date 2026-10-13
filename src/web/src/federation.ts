// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/** The Keycloak realm of an organization, as returned by the kernel before sign-in. */
export interface Federation {
  readonly issuer: string;
  readonly clientId: string;
}

/** How a person signs in: through the realm of an organization, or with a local password. */
export interface SignInOptions {
  readonly organization: string | null;
  readonly federation: Federation | null;
}

/** Tokens issued by the realm. They are kept in memory only. */
export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string | undefined;
  readonly idToken: string | undefined;
  /** Lifetime of the access token, in seconds. */
  readonly expiresIn: number;
}

interface Endpoints {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly end_session_endpoint?: string;
}

/** State kept across the redirect to the realm, in session storage. */
interface Pending {
  readonly state: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly federation: Federation;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The part of the Storage API used here, so that tests can pass a map. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PENDING_KEY = 'mosaikit.federated-sign-in';

/**
 * Sign-in through the realm of an organization with the OAuth 2.0 authorization code flow and
 * PKCE (RFC 7636), as recommended for browser applications: no client secret, the code verifier
 * never leaves the browser, and the state parameter binds the answer to this browser session.
 */
export class FederatedSignIn {
  private readonly endpoints = new Map<string, Promise<Endpoints>>();

  constructor(
    private readonly fetchImpl: Fetch = (input, init) => fetch(input, init),
    private readonly storage: KeyValueStore = sessionStorage,
  ) {}

  /** Returns the URL of the sign-in page of the realm, and remembers how to complete it. */
  async begin(federation: Federation, loginHint: string, redirectUri: string): Promise<string> {
    const endpoints = await this.discover(federation.issuer);
    const pending: Pending = {
      state: randomString(16),
      verifier: randomString(32),
      redirectUri,
      federation,
    };
    this.storage.setItem(PENDING_KEY, JSON.stringify(pending));
    const url = new URL(endpoints.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: federation.clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state: pending.state,
      code_challenge: await pkceChallenge(pending.verifier),
      code_challenge_method: 'S256',
      ...(loginHint ? { login_hint: loginHint } : {}),
    }).toString();
    return url.toString();
  }

  /**
   * Completes a sign-in when the location is the answer of the realm. Returns undefined when the
   * location is not such an answer.
   */
  async complete(location: URL): Promise<{ tokens: Tokens; federation: Federation } | undefined> {
    const code = location.searchParams.get('code');
    const state = location.searchParams.get('state');
    const error = location.searchParams.get('error');
    const stored = this.storage.getItem(PENDING_KEY);
    if (!stored || !state || (!code && !error)) {
      return undefined;
    }
    this.storage.removeItem(PENDING_KEY);
    const pending = JSON.parse(stored) as Pending;
    if (state !== pending.state) {
      throw new Error('The answer of the identity provider does not match this sign-in.');
    }
    if (error || !code) {
      throw new Error(location.searchParams.get('error_description') ?? 'Sign-in was cancelled.');
    }
    const tokens = await this.token(pending.federation, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
    });
    return { tokens, federation: pending.federation };
  }

  /** Gets new tokens with the refresh token, before the access token expires. */
  refresh(federation: Federation, refreshToken: string): Promise<Tokens> {
    return this.token(federation, { grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /** URL that ends the session at the realm and comes back to the given address. */
  async signOutUrl(
    federation: Federation,
    idToken: string | undefined,
    redirectUri: string,
  ): Promise<string | undefined> {
    const endpoints = await this.discover(federation.issuer);
    if (!endpoints.end_session_endpoint) {
      return undefined;
    }
    const url = new URL(endpoints.end_session_endpoint);
    url.search = new URLSearchParams({
      client_id: federation.clientId,
      post_logout_redirect_uri: redirectUri,
      ...(idToken ? { id_token_hint: idToken } : {}),
    }).toString();
    return url.toString();
  }

  private async token(federation: Federation, parameters: Record<string, string>): Promise<Tokens> {
    const endpoints = await this.discover(federation.issuer);
    const response = await this.fetchImpl(endpoints.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: federation.clientId, ...parameters }).toString(),
    });
    if (!response.ok) {
      throw new Error('The identity provider refused the sign-in.');
    }
    const body = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
    };
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      idToken: body.id_token,
      expiresIn: body.expires_in ?? 300,
    };
  }

  private discover(issuer: string): Promise<Endpoints> {
    let endpoints = this.endpoints.get(issuer);
    if (!endpoints) {
      endpoints = this.fetchImpl(`${issuer}/.well-known/openid-configuration`).then(
        async (response) => {
          if (!response.ok) {
            throw new Error('The identity provider of the organization cannot be reached.');
          }
          return (await response.json()) as Endpoints;
        },
      );
      endpoints.catch(() => this.endpoints.delete(issuer));
      this.endpoints.set(issuer, endpoints);
    }
    return endpoints;
  }
}

/** The S256 code challenge of a PKCE code verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function randomString(bytes: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  // Base64 ends with at most two padding characters.
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/={1,2}$/, '');
}
