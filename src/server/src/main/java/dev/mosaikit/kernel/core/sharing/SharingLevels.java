// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.extension.SharingRemoval;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.extension.ExtensionsLoaded;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.transaction.Transactional;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.jboss.logging.Logger;

/**
 * The levels of sharing of the installed extensions (MK-055): writes the order of the levels of
 * every active type in {@code mk_kernel.sharing_level}, which {@code mk_kernel.allows()} reads, and
 * refuses an update that removes a type or a level on which grants exist.
 */
@ApplicationScoped
public class SharingLevels {

    private static final Logger LOG = Logger.getLogger(SharingLevels.class);

    /** Most grants named in the refusal of an update; the others are counted. */
    static final int MAX_LISTED = 50;

    private static final String GRANTS_AT = """
            select o.slug, r.type, r.ref_id, r.title, g.subject_kind,
                   coalesce(a.username, t.name, ''), g.level
            from mk_kernel.resource_grant g
            join mk_kernel.resource r on r.id = g.resource_id
            join mk_kernel.organization o on o.id = g.organization_id
            left join mk_kernel.user_account a on a.id = g.account_id
            left join mk_kernel.team t on t.id = g.team_id
            where r.extension_id = ? and r.type = ? and g.level = any (?)
              and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
            order by o.slug, r.type, r.ref_id, g.subject_kind""";

    private final AgroalDataSource dataSource;

    public SharingLevels(AgroalDataSource dataSource) {
        this.dataSource = dataSource;
    }

    void onExtensionsLoaded(@Observes ExtensionsLoaded event) {
        refresh(event.active());
    }

    /** Writes the levels of the resource types of these extensions, the active ones, in place of the others. */
    @Transactional
    public void refresh(Collection<InstalledExtension> active) {
        try (Connection connection = dataSource.getConnection()) {
            try (Statement statement = connection.createStatement()) {
                statement.executeUpdate("delete from mk_kernel.sharing_level");
            }
            try (PreparedStatement insert = connection.prepareStatement(
                    "insert into mk_kernel.sharing_level (extension_id, type, level, rank, administrators)"
                            + " values (?, ?, ?, ?, ?)")) {
                for (InstalledExtension extension : active) {
                    if (extension.manifest().isEmpty()) {
                        continue;
                    }
                    for (ResourceTypeEntry type :
                            ResourceTypes.all(extension.manifest().get())) {
                        List<String> levels = type.levelNames();
                        for (int rank = 0; rank < levels.size(); rank++) {
                            insert.setString(1, extension.key());
                            insert.setString(2, type.type());
                            insert.setString(3, levels.get(rank));
                            insert.setInt(4, rank);
                            insert.setBoolean(5, ResourceTypes.administratorsHoldEveryLevel(type));
                            insert.addBatch();
                        }
                    }
                }
                insert.executeBatch();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Cannot write the levels of sharing", e);
        }
    }

    /**
     * Refuses an update of an extension that removes a resource type, or a level of one, on which
     * grants exist in any organization, naming those grants (ADR-0037): they are revoked first.
     *
     * @param current the manifest of the installed version
     * @param update the manifest of the version that replaces it
     * @throws ConflictException listing the grants
     */
    public void refuseRemovals(ExtensionManifest current, ExtensionManifest update) {
        List<SharingRemoval> removed = current.sharingRemovedBy(update);
        if (removed.isEmpty()) {
            return;
        }
        List<String> grants = grantsAt(current.id(), removed);
        if (grants.isEmpty()) {
            return;
        }
        List<String> listed = grants.subList(0, Math.min(MAX_LISTED, grants.size()));
        String more = grants.size() > MAX_LISTED ? "; and " + (grants.size() - MAX_LISTED) + " more" : "";
        throw new ConflictException("The update of " + current.id() + " removes "
                + describe(removed) + ", which " + grants.size()
                + (grants.size() == 1 ? " grant uses" : " grants use")
                + ": revoke " + (grants.size() == 1 ? "it" : "them") + " first: "
                + String.join("; ", listed) + more + ".");
    }

    private static String describe(List<SharingRemoval> removed) {
        return String.join(
                ", ",
                removed.stream()
                        .map(removal -> removal.wholeType()
                                ? "the resource type " + removal.type()
                                : "the levels " + String.join(", ", removal.levels()) + " of " + removal.type())
                        .toList());
    }

    /**
     * The live grants, in every organization, at the levels removed. Read on a thread of its own,
     * outside the request, as the owner of the tables: row-level security would otherwise show only
     * those of the organization of the administrator.
     */
    List<String> grantsAt(String extension, List<SharingRemoval> removed) {
        AtomicReference<Object> result = new AtomicReference<>();
        Thread reader = Thread.ofVirtual().unstarted(() -> {
            try {
                result.set(read(extension, removed));
            } catch (RuntimeException e) {
                result.set(e);
            }
        });
        reader.start();
        try {
            reader.join();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while reading the grants", e);
        }
        if (result.get() instanceof RuntimeException failure) {
            throw failure;
        }
        @SuppressWarnings("unchecked")
        List<String> grants = (List<String>) result.get();
        return grants;
    }

    private List<String> read(String extension, List<SharingRemoval> removed) {
        List<String> grants = new ArrayList<>();
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(GRANTS_AT)) {
            for (SharingRemoval removal : removed) {
                statement.setString(1, extension);
                statement.setString(2, removal.type());
                statement.setArray(
                        3, connection.createArrayOf("varchar", removal.levels().toArray()));
                try (ResultSet rows = statement.executeQuery()) {
                    while (rows.next()) {
                        String subject = rows.getString(5);
                        String name = rows.getString(6);
                        grants.add("%s: %s %s (%s) shared with %s at %s"
                                .formatted(
                                        rows.getString(1),
                                        rows.getString(2),
                                        rows.getString(3),
                                        rows.getString(4),
                                        name.isEmpty() ? subject : subject + " " + name,
                                        rows.getString(7)));
                    }
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Cannot read the grants of " + extension, e);
        }
        if (!grants.isEmpty()) {
            LOG.infof("An update of %s would remove levels with %d grants", extension, grants.size());
        }
        return grants;
    }
}
