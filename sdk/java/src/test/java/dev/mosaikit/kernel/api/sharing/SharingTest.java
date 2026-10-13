// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.sharing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.api.permission.AccessDeniedException;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("MK-055")
class SharingTest {

    private static final ResourceRef DASHBOARD = new ResourceRef("dev.example.dashboards", "dashboard", "42");
    private static final UUID PERSON = UUID.randomUUID();

    @Test
    void namesEveryKindOfSubject() {
        UUID team = UUID.randomUUID();
        UUID link = UUID.randomUUID();
        Instant expires = Instant.parse("2026-12-31T00:00:00Z");

        assertThat(List.of(
                                Subject.person(PERSON),
                                Subject.group(team),
                                Subject.organization(),
                                new Subject.Link(link, expires),
                                Subject.everyone())
                        .stream()
                        .map(Subject::kind))
                .containsExactly(SubjectKind.values());
        assertThat(Subject.person(PERSON)).isEqualTo(new Subject.Person(PERSON));
        assertThat(Subject.group(team)).isEqualTo(new Subject.Group(team));
        assertThatThrownBy(() -> Subject.person(null)).isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> Subject.group(null)).isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> new Subject.Link(link, null)).isInstanceOf(NullPointerException.class);
    }

    @Test
    void readsTheKindsOfSubjectsAsWrittenInManifests() {
        assertThat(SubjectKind.fromValue("organization")).contains(SubjectKind.ORGANIZATION);
        assertThat(SubjectKind.fromValue("everyone")).isEmpty();
        assertThat(SubjectKind.PUBLIC.value()).isEqualTo("public");
        assertThat(SubjectKind.DEFAULT).doesNotContain(SubjectKind.LINK, SubjectKind.PUBLIC);
    }

    @Test
    void aSharedLinkIsTheGrantOfALink() {
        Grant toLink = grant(new Subject.Link(UUID.randomUUID(), Instant.now()));
        Grant toPerson = grant(Subject.person(PERSON));

        assertThat(new SharedLink(toLink, "/s/secret").grant()).isEqualTo(toLink);
        assertThatThrownBy(() -> new SharedLink(toPerson, "/s/secret")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> grant(null)).isInstanceOf(NullPointerException.class);
    }

    @Test
    void requireRefusesWith403ALowerLevelAndWith404NoLevelAtAll() {
        Sharing viewer = new FixedLevels(Map.of(DASHBOARD, "view"));

        viewer.require(DASHBOARD, "view");
        assertThatThrownBy(() -> viewer.require(DASHBOARD, "edit"))
                .isInstanceOfSatisfying(
                        AccessDeniedException.class,
                        denied -> assertThat(denied.concealed()).isFalse());
        assertThatThrownBy(() -> new FixedLevels(Map.of()).require(DASHBOARD, "view"))
                .isInstanceOfSatisfying(
                        AccessDeniedException.class,
                        denied -> assertThat(denied.concealed()).isTrue());
    }

    private static Grant grant(Subject subject) {
        return new Grant(UUID.randomUUID(), DASHBOARD, subject, "view", PERSON, Instant.now());
    }

    /** Levels view and edit, with the level of the request on each resource. */
    private record FixedLevels(Map<ResourceRef, String> levels) implements Sharing {

        private static final List<String> ORDER = List.of("view", "edit");

        @Override
        public Optional<String> level(ResourceRef resource) {
            return Optional.ofNullable(levels.get(resource));
        }

        @Override
        public boolean allows(ResourceRef resource, String level) {
            return level(resource)
                    .map(own -> ORDER.indexOf(own) >= ORDER.indexOf(level))
                    .orElse(false);
        }

        @Override
        public Grant grant(ResourceRef resource, Subject subject, String level) {
            throw new UnsupportedOperationException();
        }

        @Override
        public SharedLink createLink(ResourceRef resource, String level, Instant expires) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void revoke(UUID grant) {
            throw new UnsupportedOperationException();
        }

        @Override
        public List<Grant> grants(ResourceRef resource) {
            return List.of();
        }

        @Override
        public Optional<String> level(UUID person, ResourceRef resource) {
            return level(resource);
        }

        @Override
        public boolean allows(UUID person, ResourceRef resource, String level) {
            return allows(resource, level);
        }

        @Override
        public Set<String> visible(String extension, String type, String level) {
            return Set.of();
        }

        @Override
        public Set<String> visible(UUID person, String extension, String type, String level) {
            return Set.of();
        }
    }
}
