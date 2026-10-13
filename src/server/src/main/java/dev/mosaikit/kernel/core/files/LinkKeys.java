// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import dev.mosaikit.kernel.core.secrets.SecretKeys;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.jboss.logging.Logger;

/**
 * The keys that sign the links to files (MK-093): the current one, which signs every new link, and
 * the former ones of a rotation, which only verify. They come from {@code mosaikit.files.link-key}
 * and {@code mosaikit.files.link-previous-keys} when set; otherwise they are derived with HKDF-SHA256
 * from the master keys of the store of credentials (MK-062), current and former, under a label of
 * their own, so that the master key never signs anything itself and a rotation of the master key
 * rotates the link keys too. Without either, no link can be made, and every link is refused.
 *
 * <p>No message of this class contains a key nor a part of one.
 */
@ApplicationScoped
public class LinkKeys {

    private static final Logger LOG = Logger.getLogger(LinkKeys.class);

    /** The label of the derivation from a master key: a key derived for nothing else. */
    static final byte[] LABEL = "mosaikit.files.signed-links.v1".getBytes(StandardCharsets.US_ASCII);

    /** The shortest key given in the configuration, and the length of a derived key. */
    static final int KEY_BYTES = 32;

    private static final String HMAC = "HmacSHA256";

    /** Where the keys come from, for the log and the guide. */
    enum Source {
        CONFIGURED,
        DERIVED,
        NONE
    }

    private final List<byte[]> keys;
    private final Source source;
    private final String problem;

    @Inject
    public LinkKeys(KernelConfig config, SecretKeys secrets) {
        this(config.files().linkKey(), config.files().linkPreviousKeys().orElse(List.of()), masterKeys(secrets));
    }

    LinkKeys(Optional<String> linkKey, List<String> previous, List<byte[]> masterKeys) {
        List<byte[]> found = new ArrayList<>();
        Source from = Source.NONE;
        String failure = null;
        try {
            if (linkKey.filter(value -> !value.isBlank()).isPresent()) {
                found.add(decode(linkKey.get(), "mosaikit.files.link-key"));
                for (int index = 0; index < previous.size(); index++) {
                    found.add(decode(previous.get(index), "mosaikit.files.link-previous-keys[" + index + "]"));
                }
                from = Source.CONFIGURED;
            } else if (!masterKeys.isEmpty()) {
                for (byte[] master : masterKeys) {
                    found.add(derive(master));
                }
                from = Source.DERIVED;
            } else {
                failure = "the installation has neither mosaikit.files.link-key nor a master key"
                        + " (mosaikit.secrets.master-key)";
            }
        } catch (IllegalArgumentException e) {
            found.clear();
            from = Source.NONE;
            failure = e.getMessage();
        }
        this.keys = List.copyOf(found);
        this.source = from;
        this.problem = failure;
    }

    /** The master keys of the store of credentials, the current one first; none when it is disabled. */
    private static List<byte[]> masterKeys(SecretKeys secrets) {
        if (!secrets.enabled()) {
            return List.of();
        }
        List<byte[]> keys = new ArrayList<>();
        keys.add(secrets.current().key().getEncoded());
        for (String id : secrets.previousIds()) {
            secrets.find(id).ifPresent(key -> keys.add(key.key().getEncoded()));
        }
        return keys;
    }

    void onStart(@Observes StartupEvent event) {
        switch (source) {
            case CONFIGURED ->
                LOG.infof("Links to files are signed with mosaikit.files.link-key, %d former keys", keys.size() - 1);
            case DERIVED ->
                LOG.infof(
                        "Links to files are signed with a key derived from the master key," + " %d former keys",
                        keys.size() - 1);
            case NONE -> LOG.warnf("Links to files are disabled: %s.", problem);
        }
    }

    /** Whether links can be made and opened. */
    public boolean enabled() {
        return !keys.isEmpty();
    }

    Source source() {
        return source;
    }

    /**
     * The key that signs new links.
     *
     * @throws ServiceUnavailableException when links are disabled
     */
    byte[] current() {
        if (keys.isEmpty()) {
            throw new ServiceUnavailableException("Links to files are disabled: " + problem + ".");
        }
        return keys.getFirst();
    }

    /** Every key that verifies a link, the current one first. */
    List<byte[]> all() {
        return keys;
    }

    /** A key in base64 of at least {@value #KEY_BYTES} bytes; a failure names its source, never the key. */
    private static byte[] decode(String text, String source) {
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(text.strip());
        } catch (IllegalArgumentException _) {
            throw new IllegalArgumentException(source + " is not in base64");
        }
        if (bytes.length < KEY_BYTES) {
            throw new IllegalArgumentException(source + " must be at least " + KEY_BYTES
                    + " bytes in base64, such as the output of: openssl rand -base64 32");
        }
        return bytes;
    }

    /** HKDF-SHA256 (RFC 5869) of a master key, without salt, with the label of links: 32 bytes. */
    static byte[] derive(byte[] master) {
        try {
            Mac extract = Mac.getInstance(HMAC);
            extract.init(new SecretKeySpec(new byte[KEY_BYTES], HMAC));
            byte[] pseudorandom = extract.doFinal(master);
            Mac expand = Mac.getInstance(HMAC);
            expand.init(new SecretKeySpec(pseudorandom, HMAC));
            expand.update(LABEL);
            expand.update((byte) 1);
            return expand.doFinal();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA256 is not available", e);
        }
    }
}
