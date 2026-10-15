-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-133: the extensions active in the installation when the kernel last read the extensions
-- directory, as a JSON object of identifier and version. At each reading, at start too, the kernel
-- compares them with those it finds, tells the organizations which extensions became active or
-- inactive, and records the new ones. One row, read under a lock, so that several kernels of an
-- installation tell each change once. It belongs to no organization: only the kernel reads and
-- writes it, as the owner; row-level security is on without a policy, so the member role of
-- requests sees no row.

create table extension_presence (
    id         smallint     primary key default 1 check (id = 1),
    active     text         not null,
    updated_at timestamptz  not null default now()
);

alter table extension_presence enable row level security;
