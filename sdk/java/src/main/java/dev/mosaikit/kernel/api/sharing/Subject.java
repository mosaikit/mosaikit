// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.sharing;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Who a resource is shared with (MK-055, ADR-0037). */
public sealed interface Subject {

    /** The kind of the subject, which the resource type must accept. */
    SubjectKind kind();

    /**
     * One person of the organization.
     *
     * @param account the account of the person
     */
    record Person(UUID account) implements Subject {
        public Person {
            Objects.requireNonNull(account, "account");
        }

        @Override
        public SubjectKind kind() {
            return SubjectKind.PERSON;
        }
    }

    /**
     * A group of the organization: the people of a team (MK-032), guests of the team included, as
     * they are at every check and not as they were when the grant was made.
     *
     * @param team the identifier of the team
     */
    record Group(UUID team) implements Subject {
        public Group {
            Objects.requireNonNull(team, "team");
        }

        @Override
        public SubjectKind kind() {
            return SubjectKind.GROUP;
        }
    }

    /** Every member of the organization of the resource; its guests are not included. */
    record Organization() implements Subject {
        @Override
        public SubjectKind kind() {
            return SubjectKind.ORGANIZATION;
        }
    }

    /**
     * Anyone who opens a link made by the kernel with {@link Sharing#createLink}, also without an
     * account, until the link expires or its grant is revoked; after that the link answers not
     * found. Every use of a link is in the audit log. A link is never passed to {@link Sharing#grant}.
     *
     * @param link the identifier of the link; not the secret of its address
     * @param expires when the link stops working
     */
    record Link(UUID link, Instant expires) implements Subject {
        public Link {
            Objects.requireNonNull(link, "link");
            Objects.requireNonNull(expires, "expires");
        }

        @Override
        public SubjectKind kind() {
            return SubjectKind.LINK;
        }
    }

    /** Anyone, also people without an account and people of other organizations. */
    record Public() implements Subject {
        @Override
        public SubjectKind kind() {
            return SubjectKind.PUBLIC;
        }
    }

    /** A person, by account. */
    static Subject person(UUID account) {
        return new Person(account);
    }

    /** A group, by team. */
    static Subject group(UUID team) {
        return new Group(team);
    }

    /** The whole organization of the resource. */
    static Subject organization() {
        return new Organization();
    }

    /** Anyone. */
    static Subject everyone() {
        return new Public();
    }
}
