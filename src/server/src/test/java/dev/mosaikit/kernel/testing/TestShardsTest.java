// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.testing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/** The shards in which the CI runs the tests of the kernel. */
class TestShardsTest {

    private static Properties listed() throws IOException {
        Properties properties = new Properties();
        try (InputStream in = TestShards.class.getResourceAsStream("/test-shards.properties")) {
            properties.load(in);
        }
        return properties;
    }

    @Test
    void everyClassRunsInExactlyOneShard() throws IOException {
        Properties listed = listed();
        for (String type : new String[] {
            "dev.mosaikit.kernel.app.PermissionsTest", "dev.mosaikit.kernel.app.SharingTest", "a.b.NewTest", "C"
        }) {
            long shards = IntStream.rangeClosed(1, 2)
                    .filter(index -> new TestShards(index + "/2", listed).shardOf(type) == index)
                    .count();
            assertThat(shards).as(type).isEqualTo(1);
        }
    }

    @Test
    void theListedClassesGoToTheirShardAndTheOthersByTheirName() {
        Properties listed = new Properties();
        listed.setProperty("a.Slow", "2");
        TestShards shards = new TestShards("1/2", listed);

        assertThat(shards.shardOf("a.Slow")).isEqualTo(2);
        assertThat(shards.shardOf("a.Other")).isEqualTo(Math.floorMod("Other".hashCode(), 2) + 1);
        // A listed shard beyond the count wraps around.
        assertThat(new TestShards("1/1", listed).shardOf("a.Slow")).isEqualTo(1);
    }

    @Test
    void theSlowestClassesAreInDifferentShards() throws IOException {
        Properties listed = listed();

        assertThat(listed.getProperty("dev.mosaikit.kernel.app.PermissionsTest"))
                .isNotEqualTo(listed.getProperty("dev.mosaikit.kernel.app.SharingTest"));
        assertThat(listed.getProperty("dev.mosaikit.launcher.JavaExtensionInstallationIT"))
                .isNotEqualTo(listed.getProperty("dev.mosaikit.kernel.app.FederatedIdentityTest"));
    }

    @Test
    void everyListedClassExists() throws IOException {
        for (String type : listed().stringPropertyNames()) {
            assertThat(TestShardsTest.class.getClassLoader().getResource(type.replace('.', '/') + ".class"))
                    .as("%s, listed in test-shards.properties", type)
                    .isNotNull();
        }
    }

    @Test
    void refusesAWrongShard() {
        for (String shard : new String[] {"3/2", "0/2", "1", "a/b", "1/0"}) {
            assertThatThrownBy(() -> new TestShards(shard, new Properties()))
                    .as(shard)
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("test.shard");
        }
    }
}
