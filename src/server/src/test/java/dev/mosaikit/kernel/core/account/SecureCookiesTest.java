// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** {@code mosaikit.accounts.secure-cookies}: Secure follows the scheme, or is always set. */
@Tag("MK-125")
@Tag("MK-047")
class SecureCookiesTest {

    @Test
    void followsTheSchemeOfTheRequestByDefault() {
        SecureCookies cookies = new SecureCookies(false);
        assertThat(cookies.secure("https")).isTrue();
        assertThat(cookies.secure("http")).isFalse();
        assertThat(cookies.secure((String) null)).isFalse();
    }

    @Test
    void isAlwaysSecureWhenTheInstallationSaysSo() {
        SecureCookies cookies = new SecureCookies(true);
        assertThat(cookies.secure("http")).isTrue();
        assertThat(cookies.secure("https")).isTrue();
        assertThat(cookies.secure((String) null)).isTrue();
    }
}
