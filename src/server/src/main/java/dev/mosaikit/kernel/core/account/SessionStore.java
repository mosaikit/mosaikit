// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The database side of {@link SessionRegistry}: each method is a transaction, also when called
 * during authentication, outside of any request. Ending sessions commits at once, in a transaction of
 * its own, so that no request reads them as live once the registry forgot them.
 */
@ApplicationScoped
@Transactional
@ActivateRequestContext
public class SessionStore {

    private final AccountSessions sessions;
    private final RememberTokens tokens;

    public SessionStore(AccountSessions sessions, RememberTokens tokens) {
        this.sessions = sessions;
        this.tokens = tokens;
    }

    Optional<AccountSession> byDigest(String digest) {
        return sessions.findByTokenDigest(digest);
    }

    Optional<AccountSession> byId(UUID id) {
        return sessions.findById(id);
    }

    /** In a transaction of its own, so that losing a race on the digest fails only the insert. */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    void insert(AccountSession session) {
        sessions.insert(session);
    }

    void touch(UUID id, UUID organizationId, Instant now) {
        if (organizationId == null) {
            sessions.touch(id, now);
        } else {
            sessions.touchIn(id, organizationId, now);
        }
    }

    void renew(UUID id, Instant now, Instant expiresAt) {
        sessions.renew(id, now, expiresAt);
    }

    /** Ends a session and revokes the "remember me" tokens asked in it. */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    boolean end(UUID id, Instant now, Instant keepRealmUntil) {
        boolean ended = sessions.end(id, now) > 0;
        sessions.keepEndedRealmSession(id, keepRealmUntil);
        tokens.deleteBySessionId(id);
        return ended;
    }

    /** Ends every session of an account and revokes all its "remember me" tokens. */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    void endAllOf(UUID accountId, Instant now, Instant keepRealmUntil) {
        sessions.endAllOf(accountId, now);
        sessions.keepEndedRealmSessions(accountId, keepRealmUntil);
        tokens.deleteByAccountId(accountId);
    }

    /** Ends the sessions of an account in an organization, or in none, and revokes their tokens. */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    void endIn(UUID accountId, UUID organizationId, Instant now, Instant keepRealmUntil) {
        sessions.endIn(accountId, organizationId, now);
        sessions.keepEndedRealmSessions(accountId, keepRealmUntil);
        tokens.deleteOfEndedSessions(accountId);
    }

    List<AccountSession> open(UUID accountId, Instant now) {
        return sessions.findOpen(accountId, now);
    }

    void moveToken(UUID tokenId, UUID sessionId) {
        tokens.moveToSession(tokenId, sessionId);
    }

    int deleteExpired(Instant now, Instant idleSince) {
        return sessions.deleteExpired(now, idleSince);
    }
}
