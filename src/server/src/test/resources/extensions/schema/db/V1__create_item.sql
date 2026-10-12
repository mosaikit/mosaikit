-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0

create table item (
    id   integer primary key,
    name varchar(40) not null
);

insert into item (id, name) values (1, 'migrated');
