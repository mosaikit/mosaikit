// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import jakarta.data.repository.Delete;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.List;
import java.util.Optional;

/**
 * Jakarta Data repository of the credentials of the installation (MK-127). The member role of
 * requests has no right on the table: callers run as the owner first.
 */
@Repository
public interface InstallationSecrets {

    @Query("from InstallationSecret s order by s.name")
    List<InstallationSecret> list();

    @Query("from InstallationSecret s where s.name = :name")
    Optional<InstallationSecret> find(String name);

    @Insert
    void insert(InstallationSecret secret);

    @Update
    void update(InstallationSecret secret);

    @Delete
    void delete(InstallationSecret secret);
}
