// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.secrets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The value of a credential never shows itself, and is usable as characters, bytes or a string (MK-062). */
@Tag("MK-062")
class SecretValueTest {

    private static final String VALUE = "sk-acme-ünïcode-0123456789";

    @Test
    void masksTheValueInToString() {
        SecretValue value = SecretValue.of(VALUE.toCharArray());
        assertThat(value.toString()).doesNotContain(VALUE).contains("••••");
        assertThat(String.valueOf(List.of(value))).doesNotContain(VALUE);
        assertThat(value).isNotEqualTo(SecretValue.of(VALUE.toCharArray()));
    }

    @Test
    void givesCopiesAsCharactersBytesOrAString() {
        char[] given = VALUE.toCharArray();
        SecretValue value = SecretValue.of(given);
        given[0] = 'X';
        assertThat(value.chars()).containsExactly(VALUE.toCharArray());
        assertThat(value.bytes()).isEqualTo(VALUE.getBytes(StandardCharsets.UTF_8));
        assertThat(value.reveal()).isEqualTo(VALUE);
        assertThat(value.length()).isEqualTo(VALUE.length());
        char[] taken = value.chars();
        taken[1] = 'Y';
        assertThat(value.reveal()).isEqualTo(VALUE);
        assertThat(SecretValue.ofUtf8(VALUE.getBytes(StandardCharsets.UTF_8)).reveal())
                .isEqualTo(VALUE);
    }

    @Test
    void closingOverwritesTheValue() {
        SecretValue value = SecretValue.of(VALUE.toCharArray());
        value.close();
        value.close();
        assertThatThrownBy(value::reveal)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageNotContaining(VALUE);
        assertThatThrownBy(value::chars).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(value::bytes).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(value::length).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aMissingCredentialIsNamedAndNothingElse() {
        Secrets none = (extension, name) -> Optional.empty();
        assertThatThrownBy(() -> none.require("org.example.reports", "model-provider"))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessage("No credential named model-provider for org.example.reports in the organization.");
        Secrets one = (extension, name) -> Optional.of(SecretValue.of(VALUE.toCharArray()));
        assertThat(one.require("org.example.reports", "model-provider").reveal())
                .isEqualTo(VALUE);
    }
}
