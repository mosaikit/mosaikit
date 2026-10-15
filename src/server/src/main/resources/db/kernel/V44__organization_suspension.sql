-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-072: a platform administrator suspends an organization, and reactivates it. While it is
-- suspended its members sign in to it by no means and their sessions in it end; its data stay as
-- they are, and it is listed with when, by whom and why it was suspended.

alter table organization add column suspended_at timestamptz;
alter table organization add column suspended_by varchar(255);
alter table organization add column suspension_reason varchar(500);

alter table organization add constraint organization_suspension_ck check (
    (suspended_at is null and suspended_by is null and suspension_reason is null)
    or (suspended_at is not null and suspended_by is not null));
