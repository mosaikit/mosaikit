-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-125: why and by whom a platform administrator suspended an account, shown to the other
-- administrators next to its status. Both are emptied when the account is reactivated; the audit log
-- keeps them for good.

alter table user_account add column suspension_reason varchar(500);
-- Who suspended it; no foreign key: the value stays when they leave.
alter table user_account add column suspended_by varchar(320);
