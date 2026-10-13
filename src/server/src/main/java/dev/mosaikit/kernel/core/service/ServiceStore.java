// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import dev.mosaikit.kernel.core.data.KernelWrites;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The database side of {@link ServiceRegistry}: each method is a transaction, also when called during
 * authentication, outside of any request. Revoking commits at once, in a transaction of its own, so
 * that no request reads the key as live once the registry forgot it.
 */
@KernelWrites
@ApplicationScoped
@Transactional
@ActivateRequestContext
public class ServiceStore {

    /** A key with its identity, as authentication reads them. */
    record Loaded(ServiceKey key, ServiceIdentity identity) {}

    private final ServiceIdentities identities;
    private final ServiceKeys keys;

    public ServiceStore(ServiceIdentities identities, ServiceKeys keys) {
        this.identities = identities;
        this.keys = keys;
    }

    Optional<Loaded> byDigest(String digest) {
        return keys.findByTokenDigest(digest)
                .flatMap(key -> identities.findById(key.getServiceId()).map(identity -> new Loaded(key, identity)));
    }

    Optional<ServiceIdentity> byId(UUID id) {
        return identities.findById(id);
    }

    Optional<ServiceIdentity> byName(String name) {
        return identities.findByName(name);
    }

    List<ServiceIdentity> all() {
        return identities.all();
    }

    List<ServiceKey> liveKeys() {
        return keys.findLive();
    }

    List<ServiceKey> liveKeysOf(UUID serviceId) {
        return keys.findLiveOf(serviceId);
    }

    void insert(ServiceIdentity identity, ServiceKey key) {
        identities.insert(identity);
        keys.insert(key);
    }

    void insert(ServiceKey key) {
        keys.insert(key);
    }

    void grant(ServiceIdentity identity, String description, ServiceIdentity.Grants grants) {
        identities.grant(
                identity.getId(),
                description,
                ServiceIdentity.join(grants.apis()),
                ServiceIdentity.join(grants.endpoints()),
                ServiceIdentity.joinIds(grants.organizations()));
    }

    void touch(UUID id, Instant now) {
        keys.touch(id, now);
    }

    @Transactional(Transactional.TxType.REQUIRES_NEW)
    boolean revoke(UUID serviceId, UUID id, Instant now) {
        return keys.revoke(serviceId, id, now) > 0;
    }
}
