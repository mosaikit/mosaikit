// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.data;

import jakarta.interceptor.InterceptorBinding;
import java.lang.annotation.ElementType;
import java.lang.annotation.Inherited;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks the kernel code that writes the tables of the installation that the member role of requests
 * may only read (ADR-0018): accounts, sessions, access keys, service identities, organizations, the
 * settings of the platform and the levels of sharing. The transaction of a marked method runs as the
 * owner of the tables from its start ({@link KernelWritesInterceptor}). A marked method that joins
 * the transaction of its caller raises that transaction too: mark only kernel code that extensions do
 * not call.
 */
@InterceptorBinding
@Inherited
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface KernelWrites {}
