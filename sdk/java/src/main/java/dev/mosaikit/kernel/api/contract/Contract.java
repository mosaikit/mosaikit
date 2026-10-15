// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.contract;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks an interface of an API artifact as one major version of a contract between extensions
 * (MK-134). The interface extends {@link ContractImplementation}; the owner of the contract declares
 * the versions it serves under {@code contracts.provides} of its manifest, and each implementing
 * extension the version it targets under {@code contracts.implements}.
 *
 * <pre>{@code
 * @Contract(extension = "org.example.catalog", name = "connector", version = 1)
 * public interface Connector extends ContractImplementation {
 *     List<Item> items(String connection);
 * }
 * }</pre>
 *
 * <p>A breaking change is a new interface with the next version, next to the old one, such as {@code
 * org.example.catalog.api.v2.Connector}: both are served until the owner retires the old one.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface Contract {

    /** The identifier of the extension that owns the contract, such as {@code org.example.catalog}. */
    String extension();

    /** The name of the contract within its extension: lowercase letters, digits and '-'. */
    String name();

    /** The major version of the contract that this interface is, from 1. */
    int version();
}
