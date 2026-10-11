-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-034: the groups of a team, such as its private channels: private teams inside a team, whose
-- people are people of the team. What a plugin shares with a group is read by its people only,
-- under the same row-level security as the documents of a team (V12).

alter table team add column parent_id uuid;
alter table team add constraint team_parent_fk foreign key (parent_id) references team (id) on delete cascade;
create index team_parent_ix on team (parent_id) where parent_id is not null;

-- Names are unique among the teams of an organization, and among the groups of a team.
alter table team drop constraint team_name_uk;
create unique index team_name_uk on team (organization_id, lower(name)) where parent_id is null;
create unique index team_group_name_uk on team (parent_id, lower(name)) where parent_id is not null;
