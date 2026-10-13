// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A credential of an organization (MK-062): what people see of it in clear, its name, kind,
 * description, the extension it is meant for and a masked hint, and its value sealed by {@link
 * SecretCipher}. The value is never kept in clear, not even in this object; {@code toString} names
 * the credential only.
 */
@Entity
@Table(name = "secret")
public class StoredSecret {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(nullable = false, updatable = false)
    private String name;

    @Column(nullable = false)
    private String kind;

    @Column(nullable = false)
    private String description;

    @Column(name = "extension_id")
    private String extensionId;

    @Column(nullable = false)
    private String hint;

    @Column(name = "key_id", nullable = false)
    private String keyId;

    @Column(name = "wrapped_key", nullable = false)
    private byte[] wrappedKey;

    @Column(nullable = false)
    private byte[] ciphertext;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false)
    private String updatedBy;

    /** Required by JPA. */
    protected StoredSecret() {}

    StoredSecret(UUID organizationId, String name, Instant now) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.name = name;
        this.createdAt = now;
    }

    /** Changes what people see of the credential. */
    void describe(String kind, String description, String extensionId, String updatedBy, Instant now) {
        this.kind = kind;
        this.description = description;
        this.extensionId = extensionId;
        this.updatedBy = updatedBy;
        this.updatedAt = now;
    }

    /** Replaces the sealed value and its hint. */
    void seal(SecretCipher.Sealed sealed, String hint) {
        this.keyId = sealed.keyId();
        this.wrappedKey = sealed.wrappedKey();
        this.ciphertext = sealed.ciphertext();
        this.hint = hint;
    }

    /** Puts the data key under another master key, for a rotation. */
    void rewrap(String keyId, byte[] wrappedKey) {
        this.keyId = keyId;
        this.wrappedKey = wrappedKey;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public String getName() {
        return name;
    }

    public String getKind() {
        return kind;
    }

    public String getDescription() {
        return description;
    }

    public String getExtensionId() {
        return extensionId;
    }

    public String getHint() {
        return hint;
    }

    public String getKeyId() {
        return keyId;
    }

    byte[] getWrappedKey() {
        return wrappedKey;
    }

    byte[] getCiphertext() {
        return ciphertext;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public String getUpdatedBy() {
        return updatedBy;
    }

    @Override
    public String toString() {
        return "StoredSecret[" + name + "]";
    }
}
