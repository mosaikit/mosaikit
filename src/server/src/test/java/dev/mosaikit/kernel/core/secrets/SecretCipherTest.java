// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import dev.mosaikit.kernel.core.secrets.SecretAdministration.SecretRequest;
import dev.mosaikit.kernel.core.secrets.SecretKeys.MasterKey;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Envelope encryption of credentials and the master keys (MK-062): values sealed under data keys
 * bound to their organization and name, former keys that still read during a rotation, a store
 * that is disabled without a valid key, and types that never show a value or a key.
 */
@Tag("MK-062")
class SecretCipherTest {

    private static final String VALUE = "sk-acme-0123456789-abcdefghij";
    private static final UUID ACME = UUID.randomUUID();
    private static final UUID GREEN = UUID.randomUUID();

    private final SecretKeys keys = SecretKeys.of(SecretRows.CURRENT, SecretRows.FORMER);

    private static byte[] bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void sealedValuesAreEqualByTheirContent() {
        SecretCipher.Sealed sealed =
                SecretCipher.seal(keys.current(), SecretCipher.binding(ACME, "openai"), bytes(VALUE));
        SecretCipher.Sealed copy = new SecretCipher.Sealed(
                sealed.keyId(), sealed.wrappedKey().clone(), sealed.ciphertext().clone());

        assertThat(copy).isEqualTo(sealed).hasSameHashCodeAs(sealed);
        assertThat(SecretCipher.seal(keys.current(), SecretCipher.binding(ACME, "openai"), bytes(VALUE)))
                .isNotEqualTo(sealed);
    }

    @Test
    void sealsEachValueWithItsOwnDataKeyAndNonce() {
        MasterKey master = keys.current();
        SecretCipher.Sealed first = SecretCipher.seal(master, SecretCipher.binding(ACME, "openai"), bytes(VALUE));
        SecretCipher.Sealed second = SecretCipher.seal(master, SecretCipher.binding(ACME, "openai"), bytes(VALUE));

        assertThat(first.keyId()).isEqualTo(SecretRows.currentId());
        assertThat(first.ciphertext()).isNotEqualTo(second.ciphertext());
        assertThat(first.wrappedKey()).isNotEqualTo(second.wrappedKey());
        String stored = HexFormat.of().formatHex(first.ciphertext())
                + new String(first.ciphertext(), StandardCharsets.ISO_8859_1);
        assertThat(stored).doesNotContain(VALUE).doesNotContain(HexFormat.of().formatHex(bytes(VALUE)));
        assertThat(new String(
                        SecretCipher.open(
                                master, SecretCipher.binding(ACME, "openai"), first.wrappedKey(), first.ciphertext()),
                        StandardCharsets.UTF_8))
                .isEqualTo(VALUE);
    }

    @Test
    void aCiphertextMovedToAnotherOrganizationOrNameDoesNotDecrypt() {
        MasterKey master = keys.current();
        SecretCipher.Sealed sealed = SecretCipher.seal(master, SecretCipher.binding(ACME, "openai"), bytes(VALUE));

        assertThatThrownBy(() -> SecretCipher.open(
                        master, SecretCipher.binding(GREEN, "openai"), sealed.wrappedKey(), sealed.ciphertext()))
                .isInstanceOf(SecretCipher.UnreadableException.class)
                .hasMessageNotContaining(VALUE);
        assertThatThrownBy(() -> SecretCipher.open(
                        master, SecretCipher.binding(ACME, "database"), sealed.wrappedKey(), sealed.ciphertext()))
                .isInstanceOf(SecretCipher.UnreadableException.class);
        byte[] changed = sealed.ciphertext().clone();
        changed[changed.length - 1] ^= 1;
        assertThatThrownBy(() ->
                        SecretCipher.open(master, SecretCipher.binding(ACME, "openai"), sealed.wrappedKey(), changed))
                .isInstanceOf(SecretCipher.UnreadableException.class);
        MasterKey former = keys.find(SecretRows.formerId()).orElseThrow();
        assertThatThrownBy(() -> SecretCipher.open(
                        former, SecretCipher.binding(ACME, "openai"), sealed.wrappedKey(), sealed.ciphertext()))
                .isInstanceOf(SecretCipher.UnreadableException.class);
    }

    @Test
    void aFormerKeyStillReadsAndARotationMovesTheDataKeyOnly() {
        SecretRows.Row old = SecretRows.sealFormer(ACME, "openai", VALUE);
        assertThat(old.keyId()).isEqualTo(SecretRows.formerId());
        assertThat(SecretRows.open(ACME, "openai", old)).isEqualTo(VALUE);

        MasterKey former = keys.find(old.keyId()).orElseThrow();
        byte[] wrapped =
                SecretCipher.rewrap(former, keys.current(), SecretCipher.binding(ACME, "openai"), old.wrappedKey());
        SecretRows.Row moved = new SecretRows.Row(SecretRows.currentId(), wrapped, old.ciphertext());

        assertThat(SecretRows.open(ACME, "openai", moved)).isEqualTo(VALUE);
        assertThat(keys.previousIds()).containsExactly(SecretRows.formerId());
    }

    @Test
    void withoutAValidMasterKeyTheStoreIsDisabledAnd503() {
        SecretKeys none = SecretKeys.of(null);
        assertThat(none.enabled()).isFalse();
        assertThatThrownBy(none::current)
                .isInstanceOf(ServiceUnavailableException.class)
                .hasMessageContaining("mosaikit.secrets.master-key");
        assertThat(none.disabled().status()).isEqualTo(503);

        SecretAdministration administration = new SecretAdministration(null, null, none, null, null, null);
        assertThatThrownBy(() -> administration.list(ACME)).isInstanceOf(ServiceUnavailableException.class);
        assertThatThrownBy(administration::listInstallation).isInstanceOf(ServiceUnavailableException.class);
        assertThatThrownBy(() -> administration.store(ACME, new SecretRequest("a", "token", VALUE, null, null), "boss"))
                .isInstanceOf(ServiceUnavailableException.class)
                .hasMessageNotContaining(VALUE);

        SecretKeys shortKey = SecretKeys.of(new byte[16]);
        assertThat(shortKey.enabled()).isFalse();
        assertThat(shortKey.problem())
                .hasValueSatisfying(
                        problem -> assertThat(problem).contains("32 bytes").contains("openssl rand -base64 32"));
    }

    @Test
    void readsTheKeyFromAFileAndNeverPutsAKeyInAMessage(@TempDir Path directory) throws IOException {
        String encoded = Base64.getEncoder().encodeToString(SecretRows.CURRENT);
        Path file = Files.writeString(directory.resolve("master.key"), encoded + "\n");
        SecretKeys fromFile = new SecretKeys(settings(Optional.empty(), Optional.of(file), List.of()));
        assertThat(fromFile.enabled()).isTrue();
        assertThat(fromFile.current().id()).isEqualTo(SecretRows.currentId());
        assertThat(fromFile.current().toString()).doesNotContain(encoded).contains(SecretRows.currentId());

        SecretKeys both = new SecretKeys(settings(Optional.of(encoded), Optional.of(file), List.of()));
        assertThat(both.enabled()).isFalse();
        assertThat(both.problem())
                .hasValueSatisfying(problem -> assertThat(problem).contains("keep one"));

        String broken = encoded.substring(0, 20) + "!!" + encoded.substring(22);
        SecretKeys invalid = new SecretKeys(settings(Optional.of(broken), Optional.empty(), List.of()));
        assertThat(invalid.problem())
                .hasValueSatisfying(problem -> assertThat(problem)
                        .contains("not in base64")
                        .doesNotContain(broken)
                        .doesNotContain(encoded.substring(0, 20)));

        SecretKeys missing =
                new SecretKeys(settings(Optional.empty(), Optional.of(directory.resolve("absent.key")), List.of()));
        assertThat(missing.problem())
                .hasValueSatisfying(problem -> assertThat(problem).contains("cannot be read"));
    }

    @Test
    void theTypesThatCarryAValueOrAKeyMaskIt() {
        SecretRequest request = new SecretRequest("openai", "token", VALUE, "The model provider", null);
        assertThat(request.toString()).doesNotContain(VALUE).contains("openai").contains("••••");
        assertThat(new SecretRequest("openai", "token", null, null, null).toString())
                .contains("value=absent");

        SecretCipher.Sealed sealed =
                SecretCipher.seal(keys.current(), SecretCipher.binding(ACME, "openai"), bytes(VALUE));
        assertThat(sealed.toString()).isEqualTo("Sealed[" + SecretRows.currentId() + "]");

        StoredSecret stored = new StoredSecret(ACME, "openai", Instant.now());
        stored.describe("token", "", null, "boss@example.org", Instant.now());
        stored.seal(sealed, SecretAdministration.hint("token", VALUE));
        assertThat(stored.toString()).isEqualTo("StoredSecret[openai]");
        assertThat(stored.getHint()).isEqualTo("••••ghij");
    }

    @Test
    void theHintShowsAtMostTheEndOfALongTokenOrKey() {
        assertThat(SecretAdministration.hint("token", VALUE)).isEqualTo("••••ghij");
        assertThat(SecretAdministration.hint("key", VALUE)).isEqualTo("••••ghij");
        assertThat(SecretAdministration.hint("password", VALUE)).isEqualTo("••••");
        assertThat(SecretAdministration.hint("other", VALUE)).isEqualTo("••••");
        assertThat(SecretAdministration.hint("token", "short-token")).isEqualTo("••••");
    }

    private static KernelConfig.Secrets settings(Optional<String> key, Optional<Path> file, List<String> previous) {
        return new KernelConfig.Secrets() {
            @Override
            public Optional<String> masterKey() {
                return key;
            }

            @Override
            public Optional<Path> masterKeyFile() {
                return file;
            }

            @Override
            public Optional<List<String>> previousKeys() {
                return Optional.of(previous);
            }
        };
    }

    @Test
    @Tag("MK-127")
    void aValueOfTheInstallationIsBoundToTheScopeOfTheInstallation() {
        SecretKeys keys = SecretKeys.of(SecretRows.CURRENT);
        SecretCipher.Sealed sealed = SecretCipher.seal(
                keys.current(), SecretCipher.installationBinding("shared"), VALUE.getBytes(StandardCharsets.UTF_8));
        assertThat(new String(
                        SecretCipher.open(
                                keys.current(),
                                SecretCipher.installationBinding("shared"),
                                sealed.wrappedKey(),
                                sealed.ciphertext()),
                        StandardCharsets.UTF_8))
                .isEqualTo(VALUE);
        // Not under another name, nor as a credential of any organization.
        assertThatThrownBy(() -> SecretCipher.open(
                        keys.current(),
                        SecretCipher.installationBinding("other"),
                        sealed.wrappedKey(),
                        sealed.ciphertext()))
                .isInstanceOf(SecretCipher.UnreadableException.class);
        assertThatThrownBy(() -> SecretCipher.open(
                        keys.current(), SecretCipher.binding(ACME, "shared"), sealed.wrappedKey(), sealed.ciphertext()))
                .isInstanceOf(SecretCipher.UnreadableException.class);
    }
}
