// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.testing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.junit.platform.engine.TestSource;
import org.junit.platform.engine.UniqueId;
import org.junit.platform.engine.support.descriptor.AbstractTestDescriptor;
import org.junit.platform.engine.support.descriptor.ClassSource;
import org.junit.platform.engine.support.descriptor.MethodSource;

/** The shards in which the CI runs the tests of the kernel. */
class TestShardsTest {

    /** The workflow of the CI, from the module src/server. */
    private static final Path CI = Path.of("..", "..", ".github", "workflows", "ci.yml");

    private static Properties listed() throws IOException {
        Properties properties = new Properties();
        try (InputStream in = TestShards.class.getResourceAsStream("/test-shards.properties")) {
            properties.load(in);
        }
        return properties;
    }

    /** The number of shards of the job backend-shard of the CI, from its matrix. */
    private static int shardsOfTheCi() throws IOException {
        String workflow = Files.readString(CI);
        Matcher matrix = Pattern.compile("(?m)^\\s+shard: \\[([0-9, ]+)]$").matcher(workflow);
        assertThat(matrix.find()).as("the matrix shard of %s", CI).isTrue();
        int[] shards = Arrays.stream(matrix.group(1).split(","))
                .map(String::strip)
                .mapToInt(Integer::parseInt)
                .toArray();
        assertThat(shards)
                .as("the matrix shard of %s", CI)
                .containsExactly(IntStream.rangeClosed(1, shards.length).toArray());
        return shards.length;
    }

    @Test
    void everyClassRunsInExactlyOneShard() throws IOException {
        Properties listed = listed();
        List<String> types = new ArrayList<>(listed.stringPropertyNames());
        types.addAll(List.of("dev.mosaikit.kernel.app.NewTest", "a.b.NewTest", "C"));
        for (int count = 1; count <= 6; count++) {
            for (String type : types) {
                int of = count;
                long shards = IntStream.rangeClosed(1, count)
                        .filter(index -> new TestShards(index + "/" + of, listed).shardOf(type) == index)
                        .count();
                assertThat(shards).as("%s with %d shards", type, count).isEqualTo(1);
            }
        }
    }

    @Test
    void theListIsMadeForTheShardsOfTheCi() throws IOException {
        int count = shardsOfTheCi();
        Properties listed = listed();
        Set<Integer> used = new TreeSet<>();
        for (String type : listed.stringPropertyNames()) {
            int shard = Integer.parseInt(listed.getProperty(type).strip());
            assertThat(shard).as("%s, listed in test-shards.properties", type).isBetween(1, count);
            used.add(shard);
        }
        assertThat(used).as("the shards given to slow classes").hasSize(count);
        assertThat(Files.readString(CI)).contains("SHARD: ${{ matrix.shard }}/" + count);
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
        listed.setProperty("a.Fourth", "4");
        listed.setProperty("a.Third", "3");
        TestShards four = new TestShards("1/4", listed);
        assertThat(four.shardOf("a.Fourth")).isEqualTo(4);
        assertThat(four.shardOf("a.Third")).isEqualTo(3);
        assertThat(four.shardOf("a.Other")).isEqualTo(Math.floorMod("Other".hashCode(), 4) + 1);
        assertThat(shards.shardOf("a.Fourth")).isEqualTo(2);
        assertThat(shards.shardOf("a.Third")).isEqualTo(1);
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
    void keepsTheMethodsRulesAndNestedClassesOfAClassInItsShard() {
        Properties listed = new Properties();
        listed.setProperty("a.Rules", "2");
        TestShards first = new TestShards("1/2", listed);
        TestShards second = new TestShards("2/2", listed);

        for (TestSource source : new TestSource[] {
            ClassSource.from("a.Rules"), ClassSource.from("a.Rules$Nested"), MethodSource.from("a.Rules", "test")
        }) {
            assertThat(first.apply(descriptor(source)).excluded())
                    .as("%s", source)
                    .isTrue();
            assertThat(second.apply(descriptor(source)).included())
                    .as("%s", source)
                    .isTrue();
        }
        // A rule of ArchUnit has a source of its own, a field: it goes with the class that holds it.
        AbstractTestDescriptor rules = descriptor(ClassSource.from("a.Rules"));
        AbstractTestDescriptor rule = descriptor(new TestSource() {});
        rules.addChild(rule);
        assertThat(first.apply(rule).excluded()).isTrue();
        assertThat(second.apply(rule).included()).isTrue();
        assertThat(first.apply(descriptor(null)).included()).isTrue();
        assertThat(new TestShards("", listed)
                        .apply(descriptor(MethodSource.from("a.Rules", "test")))
                        .included())
                .isTrue();
    }

    private static AbstractTestDescriptor descriptor(TestSource source) {
        return new AbstractTestDescriptor(UniqueId.forEngine("test"), "test", source) {
            @Override
            public Type getType() {
                return Type.TEST;
            }
        };
    }

    @Test
    void refusesAWrongShard() {
        for (String shard : new String[] {"3/2", "5/4", "0/4", "1", "a/b", "1/0", "1/2/3"}) {
            assertThatThrownBy(() -> new TestShards(shard, new Properties()))
                    .as(shard)
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("test.shard");
        }
    }
}
