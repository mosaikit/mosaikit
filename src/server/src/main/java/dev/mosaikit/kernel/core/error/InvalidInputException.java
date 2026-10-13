// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

import java.util.List;

/**
 * Arguments that do not match what the operation expects, with one problem per field, such as
 * {@code input.text is required}.
 */
public final class InvalidInputException extends DomainException {

    private static final long serialVersionUID = 1L;

    private final List<String> problems;

    public InvalidInputException(List<String> problems) {
        super("The input is not valid: " + String.join("; ", problems) + ".");
        this.problems = List.copyOf(problems);
    }

    /** The problems, each starting with the field it is about. */
    public List<String> problems() {
        return problems;
    }

    /** The problems as field errors. */
    public List<ProblemDetail.FieldError> fieldErrors() {
        return problems.stream()
                .map(problem -> {
                    int space = problem.indexOf(' ');
                    return space < 0
                            ? new ProblemDetail.FieldError("input", problem)
                            : new ProblemDetail.FieldError(problem.substring(0, space), problem.substring(space + 1));
                })
                .toList();
    }

    @Override
    public int status() {
        return 400;
    }

    @Override
    public String title() {
        return "Invalid input";
    }
}
