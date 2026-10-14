### Fixed

- Guests of an organization reach the API of an extension once a team of theirs or a personal
  exception grants them one of its permissions, or one of its resources is theirs or shared with
  them or their teams (MK-032, MK-055, MK-056); there they get only what the permissions and the
  sharing of the extension give them. Before, every extension API answered them 403.
