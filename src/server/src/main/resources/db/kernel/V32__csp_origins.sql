-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-128: the external origins (scheme, host, port) that platform administrators allow in the content
-- security policy of the shell, for images, data and tiles. The policy is of the installation: the
-- table belongs to no organization, the member role of requests has no right on it (RowSecurity
-- revokes them at every start), so neither an administrator of an organization nor the SQL of an
-- extension can widen it; row-level security without a policy shows it no row should a grant come
-- back. Only the kernel reads and writes it, as the owner of the tables.

create table csp_origin (
    -- Normal form: scheme://host[:port], in lower case, without the default port.
    origin   varchar(300) primary key,
    added_at timestamptz  not null,
    -- Who added it; no foreign key: the row stays when they leave.
    added_by varchar(320) not null
);

-- No policy: a role other than the owner sees and writes no row.
alter table csp_origin enable row level security;
