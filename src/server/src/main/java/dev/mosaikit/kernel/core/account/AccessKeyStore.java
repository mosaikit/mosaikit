// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.data.KernelWrites;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The database side of {@link AccessKeyRegistry}: each method is a transaction, also when called
 * during authentication, outside of any request. Revoking commits at once, in a transaction of its
 * own, so that no request reads the key as live once the registry forgot it.
 */
@KernelWrites
@ApplicationScoped
@Transactional
@ActivateRequestContext
public class AccessKeyStore {

    private final AccessKeys keys;

    public AccessKeyStore(AccessKeys keys) {
        this.keys = keys;
    }

    Optional<AccessKey> byDigest(String digest) {
        return keys.findByTokenDigest(digest);
    }

    Optional<AccessKey> byId(UUID id) {
        return keys.findById(id);
    }

    void insert(AccessKey key) {
        keys.insert(key);
    }

    List<AccessKey> notRevoked(UUID accountId) {
        return keys.findNotRevoked(accountId);
    }

    void touch(UUID id, Instant now) {
        keys.touch(id, now);
    }

    @Transactional(Transactional.TxType.REQUIRES_NEW)
    boolean revoke(UUID id, Instant now) {
        return keys.revoke(id, now) > 0;
    }

    @Transactional(Transactional.TxType.REQUIRES_NEW)
    void revokeAllOf(UUID accountId, Instant now) {
        keys.revokeAllOf(accountId, now);
    }

    @Transactional(Transactional.TxType.REQUIRES_NEW)
    void revokeIn(UUID accountId, UUID organizationId, Instant now) {
        keys.revokeIn(accountId, organizationId, now);
    }
}
