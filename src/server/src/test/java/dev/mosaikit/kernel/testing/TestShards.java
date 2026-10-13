// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.testing;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.Optional;
import java.util.Properties;
import org.junit.platform.engine.FilterResult;
import org.junit.platform.engine.TestDescriptor;
import org.junit.platform.engine.TestSource;
import org.junit.platform.engine.support.descriptor.ClassSource;
import org.junit.platform.engine.support.descriptor.MethodSource;
import org.junit.platform.launcher.PostDiscoveryFilter;

/**
 * Splits the tests of the kernel into shards that the CI runs at the same time, one job each:
 * {@code -Dtest.shard=1/2} runs the first half of the classes, {@code -Dtest.shard=2/2} the second.
 * Without the property every test runs.
 *
 * <p>The slow classes are given a shard in {@code test-shards.properties}, so that the shards take
 * about the same time; any other class, a new one included, goes to the shard given by the hash of
 * its simple name. A class therefore runs in exactly one shard, whether or not it is listed.
 * Registered with the JUnit Platform launcher in {@code
 * META-INF/services/org.junit.platform.launcher.PostDiscoveryFilter}; it applies to surefire and
 * failsafe alike.
 */
public final class TestShards implements PostDiscoveryFilter {

    /** The system property that names the shard, {@code <index>/<count>}. */
    public static final String PROPERTY = "test.shard";

    private final int index;
    private final int count;
    private final Properties assigned;

    public TestShards() {
        this(System.getProperty(PROPERTY, ""), load());
    }

    TestShards(String shard, Properties assigned) {
        this.assigned = assigned;
        if (shard.isBlank()) {
            index = 1;
            count = 1;
            return;
        }
        String[] parts = shard.strip().split("/");
        try {
            index = Integer.parseInt(parts[0]);
            count = parts.length == 2 ? Integer.parseInt(parts[1]) : -1;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(PROPERTY + " is <index>/<count>, such as 1/2: " + shard, e);
        }
        if (count < 1 || index < 1 || index > count) {
            throw new IllegalArgumentException(PROPERTY + " is <index>/<count>, such as 1/2: " + shard);
        }
    }

    @Override
    public FilterResult apply(TestDescriptor descriptor) {
        if (count == 1) {
            return FilterResult.included("not sharded");
        }
        Optional<String> type = descriptor.getSource().flatMap(TestShards::className);
        if (type.isEmpty()) {
            return FilterResult.included("not a test class");
        }
        int shard = shardOf(type.get());
        return FilterResult.includedIf(
                shard == index,
                () -> "in shard " + index + "/" + count,
                () -> "in shard " + shard + "/" + count + ", not " + index + "/" + count);
    }

    /** The shard of a test class, from 1 to the number of shards. */
    int shardOf(String className) {
        String listed = assigned.getProperty(className);
        if (listed != null) {
            int shard = Integer.parseInt(listed.strip());
            // With fewer shards than the list was made for, the listed shard wraps around.
            return (shard - 1) % count + 1;
        }
        String simple = className.substring(className.lastIndexOf('.') + 1);
        return Math.floorMod(simple.hashCode(), count) + 1;
    }

    /** The top-level class of a test, so that a nested class runs with the class around it. */
    private static Optional<String> className(TestSource source) {
        String name = null;
        if (source instanceof ClassSource type) {
            name = type.getClassName();
        } else if (source instanceof MethodSource method) {
            name = method.getClassName();
        }
        return Optional.ofNullable(name).map(type -> type.contains("$") ? type.substring(0, type.indexOf('$')) : type);
    }

    private static Properties load() {
        Properties properties = new Properties();
        try (InputStream in = TestShards.class.getResourceAsStream("/test-shards.properties")) {
            if (in != null) {
                properties.load(in);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return properties;
    }
}
