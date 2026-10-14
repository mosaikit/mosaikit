-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- #102, MK-041: the content of files that no longer have a record waits here before it leaves the
-- store. Deleting a team or an organization deletes the records of their files (on delete cascade of
-- stored_file), but not their content, which is in the store of the installation; the files of an
-- extension that was uninstalled stay recorded. A row of this table names a content to remove: the
-- trigger below adds one for every record deleted, whatever deleted it, and a platform administrator
-- adds those of an uninstalled extension. The content leaves the store only when a platform
-- administrator runs the clean-up, and only once mosaikit.files.removal-retention has passed, so that
-- a database restored from a backup of that time still finds its files.
--
-- The table belongs to no organization (the organization of a row may be gone): the member role of
-- requests has no right on it (RowSecurity revokes them at every start), and row-level security
-- without a policy shows it no row should a grant come back. Only the kernel reads it, as the owner.

create table file_removal (
    storage_key     varchar(600) primary key,
    file_id         uuid         not null,
    -- No foreign keys: the organization, the team and the extension may be gone.
    organization_id uuid         not null,
    extension_id    varchar(255) not null,
    size            bigint       not null,
    -- Why the content is to be removed: the file was deleted, or its team, its organization, or its
    -- extension (whose record stays until the clean-up, in case the extension comes back).
    reason          varchar(16)  not null,
    queued_at       timestamptz  not null default now(),
    constraint file_removal_reason_ck check (reason in ('file', 'team', 'organization', 'extension'))
);

create index file_removal_queued_ix on file_removal (queued_at);

alter table file_removal enable row level security;

-- Run as the owner of the tables, so that a request deleting a file, as the member role, queues its
-- content too; set search_path from current keeps it on the schema of the kernel.
create function queue_file_removal() returns trigger
    language plpgsql security definer set search_path from current as $$
begin
    insert into file_removal (storage_key, file_id, organization_id, extension_id, size, reason)
    values (old.storage_key, old.id, old.organization_id, old.extension_id, old.size,
            case
                when not exists (select 1 from organization o where o.id = old.organization_id) then 'organization'
                when old.team_id is not null
                    and not exists (select 1 from team t where t.id = old.team_id) then 'team'
                else 'file'
            end)
    on conflict (storage_key) do nothing;
    return old;
end;
$$;

create trigger stored_file_removed after delete on stored_file
    for each row execute function queue_file_removal();
