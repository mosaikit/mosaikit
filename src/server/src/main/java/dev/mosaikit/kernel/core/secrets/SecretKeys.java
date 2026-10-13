// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.jboss.logging.Logger;

/**
 * The master keys of the store of credentials (MK-062), read from the configuration: the current
 * one, which encrypts every new data key, and the former ones of a rotation, which only decrypt. The
 * keys never go in the database; each stored credential names the key of its data key by an
 * identifier derived from the key. Without a valid current key the store is disabled and every use
 * answers 503, while the rest of the kernel works.
 *
 * <p>No message of this class contains a key nor a part of one.
 */
@ApplicationScoped
public class SecretKeys {

    private static final Logger LOG = Logger.getLogger(SecretKeys.class);

    /** Length of a master key, AES-256. */
    static final int KEY_BYTES = 32;

    /** A master key with its identifier. Its {@code toString} never shows the key. */
    public record MasterKey(String id, SecretKey key) {

        @Override
        public String toString() {
            return "MasterKey[" + id + "]";
        }
    }

    private final MasterKey current;
    private final Map<String, MasterKey> all;
    private final String problem;

    @Inject
    public SecretKeys(KernelConfig config) {
        this(config.secrets());
    }

    SecretKeys(KernelConfig.Secrets settings) {
        MasterKey found = null;
        String failure = null;
        Map<String, MasterKey> keys = new LinkedHashMap<>();
        try {
            found = current(settings);
            if (found != null) {
                keys.put(found.id(), found);
            }
            List<String> previous = settings.previousKeys().orElse(List.of());
            for (int index = 0; index < previous.size(); index++) {
                MasterKey key = key(decode(previous.get(index), "mosaikit.secrets.previous-keys[" + index + "]"));
                keys.putIfAbsent(key.id(), key);
            }
        } catch (IllegalArgumentException e) {
            found = null;
            failure = e.getMessage();
        }
        if (found == null && failure == null) {
            failure = "the installation has no master key (mosaikit.secrets.master-key or"
                    + " mosaikit.secrets.master-key-file)";
        }
        this.current = failure == null ? found : null;
        this.all = failure == null ? Map.copyOf(keys) : Map.of();
        this.problem = failure;
    }

    /** Keys given directly, the first one current or {@code null}: for the tests. */
    static SecretKeys of(byte[] current, byte[]... previous) {
        List<String> former = new ArrayList<>();
        for (byte[] key : previous) {
            former.add(Base64.getEncoder().encodeToString(key));
        }
        return new SecretKeys(new KernelConfig.Secrets() {
            @Override
            public Optional<String> masterKey() {
                return Optional.ofNullable(current).map(Base64.getEncoder()::encodeToString);
            }

            @Override
            public Optional<Path> masterKeyFile() {
                return Optional.empty();
            }

            @Override
            public Optional<List<String>> previousKeys() {
                return Optional.of(former);
            }
        });
    }

    void onStart(@Observes StartupEvent event) {
        if (enabled()) {
            LOG.infof(
                    "The store of credentials is on: current master key %s, %d former keys",
                    current.id(), all.size() - 1);
        } else {
            LOG.warnf("The store of credentials is disabled: %s. Its endpoints answer 503.", problem);
        }
    }

    /** Whether the store can encrypt and decrypt. */
    public boolean enabled() {
        return current != null;
    }

    /**
     * The current master key.
     *
     * @throws ServiceUnavailableException when the store is disabled
     */
    public MasterKey current() {
        if (current == null) {
            throw disabled();
        }
        return current;
    }

    /** The master key with this identifier, current or former, if the installation has it. */
    public Optional<MasterKey> find(String id) {
        return Optional.ofNullable(all.get(id));
    }

    /** The identifiers of the former keys that are configured, without the current one. */
    public List<String> previousIds() {
        return all.keySet().stream()
                .filter(id -> current == null || !id.equals(current.id()))
                .sorted()
                .toList();
    }

    /** Why the store is disabled, or empty. */
    public Optional<String> problem() {
        return Optional.ofNullable(problem);
    }

    /** The failure of a use of a disabled store, for a 503 answer. */
    public ServiceUnavailableException disabled() {
        return new ServiceUnavailableException("The store of credentials is disabled: " + problem + ".");
    }

    private static MasterKey current(KernelConfig.Secrets settings) {
        Optional<String> inline = settings.masterKey().filter(value -> !value.isBlank());
        Optional<Path> file = settings.masterKeyFile();
        if (inline.isPresent() && file.isPresent()) {
            throw new IllegalArgumentException(
                    "both mosaikit.secrets.master-key and mosaikit.secrets.master-key-file are set; keep one");
        }
        if (inline.isPresent()) {
            return key(decode(inline.get(), "mosaikit.secrets.master-key"));
        }
        if (file.isPresent()) {
            String text;
            try {
                text = Files.readString(file.get(), StandardCharsets.US_ASCII);
            } catch (IOException | RuntimeException _) {
                throw new IllegalArgumentException(
                        "the master key file " + file.get() + " cannot be read (mosaikit.secrets.master-key-file)");
            }
            return key(decode(text, "the master key file " + file.get()));
        }
        return null;
    }

    /** Decodes a key in base64; the message of a failure names where the key comes from, never the key. */
    private static byte[] decode(String text, String source) {
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(text.strip());
        } catch (IllegalArgumentException _) {
            throw new IllegalArgumentException(source + " is not in base64");
        }
        if (bytes.length != KEY_BYTES) {
            throw new IllegalArgumentException(source + " must be " + KEY_BYTES
                    + " bytes in base64, such as the output of: openssl rand -base64 32");
        }
        return bytes;
    }

    private static MasterKey key(byte[] bytes) {
        return new MasterKey(id(bytes), new SecretKeySpec(bytes, "AES"));
    }

    /** The identifier of a key: the start of a digest of it, which tells keys apart and reveals nothing. */
    static String id(byte[] key) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update("mosaikit.secrets.key-id".getBytes(StandardCharsets.US_ASCII));
            return HexFormat.of().formatHex(digest.digest(key), 0, 6);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
