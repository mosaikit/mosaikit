// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import jakarta.persistence.Column;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import java.time.Instant;
import java.util.UUID;

/**
 * What a credential of an organization (MK-062) and one of the installation (MK-127) have in common:
 * what people see of it in clear, its name, kind, description, the extension it is meant for and a
 * masked hint, and its value sealed by {@link SecretCipher}, bound to the scope of the credential by
 * {@link #binding()}. The value is never kept in clear, not even in this object; {@code toString}
 * names the credential only.
 */
@MappedSuperclass
public abstract class SealedCredential {

    @Id
    private UUID id;

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
    protected SealedCredential() {}

    SealedCredential(String name, Instant now) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.createdAt = now;
    }

    /**
     * The associated data of both encryptions: the scope and the name of the credential, so that a
     * ciphertext moved to another row does not decrypt.
     */
    abstract byte[] binding();

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

    /** Whether an extension may read it: meant for that extension, or for any. */
    boolean readableBy(String extension) {
        return extensionId == null || extensionId.equals(extension);
    }

    public UUID getId() {
        return id;
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
        return getClass().getSimpleName() + "[" + name + "]";
    }
}
