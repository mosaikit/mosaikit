-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- Schema p_sample_notes, owned by the plugin and migrated by the kernel at start.

create table note (
    id         uuid primary key,
    text       varchar(500) not null,
    created_at timestamp with time zone not null
);
