// Checks added to docs/manual-tests.md by other work (performance, QA, development environment, plugin host)
// after this suite was written: listed so that the consistency check passes. Each one is a skipped test that says
// where its automated twin is (kernel tests, xtask unit tests, e2e) or why it is not automated here.
import type * as L from '../lib.ts'

const REASON: Record<string, string> = {
  "PERF-01": "needs more than 50 rows: covered at scale by `cargo xtask perf` (docs/reports/performance.md), not run in this suite",
  "PERF-02": "needs more than 50 rows: covered at scale by `cargo xtask perf` (docs/reports/performance.md), not run in this suite",
  "PERF-03": "needs more than 50 rows: covered at scale by `cargo xtask perf` (docs/reports/performance.md), not run in this suite; the bulk selection is also in tests/e2e/specs/10-search-profile-qa.spec.ts \"QA follow-ups\"",
  "PERF-04": "needs more than 50 rows: covered at scale by `cargo xtask perf` (docs/reports/performance.md), not run in this suite",
  "PERF-05": "Administrator Overview is being rebuilt (listkit/Overview work); automate after it lands",
  "PERF-06": "Administrator Overview is being rebuilt (listkit/Overview work); automate after it lands",
  "PERF-07": "needs more than 50 rows: covered at scale by `cargo xtask perf` (docs/reports/performance.md), not run in this suite",
  "PERF-08": "needs more than 50 rows: covered at scale by `cargo xtask perf` (docs/reports/performance.md), not run in this suite",
  "PERF-09": "needs more than 50 rows: covered at scale by `cargo xtask perf` (docs/reports/performance.md), not run in this suite",
  "PERF-10": "needs more than 50 rows: covered at scale by `cargo xtask perf` (docs/reports/performance.md), not run in this suite",
  "PERF-11": "needs a large Log on PostgreSQL with pg_trgm: `cargo xtask perf`",
  "PERF-12": "desktop SQLite concurrency: `cargo xtask perf sqlite` (the server of this suite runs PostgreSQL)",
  "PERF-13": "row-level read access through the set rule: covered by the kernel tests (crates/kernel/tests), not repeated here",
  "QA-01": "automated twin: tests/e2e/specs/10-search-profile-qa.spec.ts \"QA follow-ups\" (suspended sign-in)",
  "QA-02": "needs a second open window of a person suspended mid-session: not automated yet",
  "QA-03": "contrast in dark mode: covered by the layouts test of tests/e2e/specs/11-layouts.spec.ts (finding F2 is open)",
  "QA-04": "not automated yet (live search after a share)",
  "QA-05": "automated twin: tests/e2e/specs/10-search-profile-qa.spec.ts \"QA follow-ups\" (mail error)",
  "QA-06": "automated twin: tests/e2e/specs/10-search-profile-qa.spec.ts \"QA follow-ups\" (service detail)",
  "QA-07": "F5 open (uninstall and reinstall of an extension): automate when it is fixed",
  "QA-08": "F7 open (maintenance notice for open sessions): automate when it is fixed",
  "QA-09": "automated twin: tests/e2e/specs/10-search-profile-qa.spec.ts \"QA follow-ups\" (Home)",
  "QA-10": "CSV import: not automated yet",
  "QA-11": "not automated yet (invite several people)",
  "QA-12": "automated twin: tests/e2e/specs/10-search-profile-qa.spec.ts \"QA follow-ups\" (contact)",
  "QA-13": "not automated yet (ask for a plugin)",
  "QA-14": "not automated yet (log wording)",
  "QA-15": "not automated yet (extension permission wording)",
  "QA-16": "keyboard tab stops of the logos: not automated yet",
  "QA-17": "keyboard of the tour: not automated yet",
  "DEV-01": "creates worktrees of the repository: not run from a worktree suite; run by hand",
  "DEV-02": "creates worktrees of the repository: run by hand",
  "DEV-03": "creates worktrees of the repository: run by hand",
  "DEV-04": "runs `cargo xtask e2e` in a new worktree: run by hand",
  "DEV-05": "automated twin: unit test slots_are_exclusive_and_taken_over_when_stale in xtask/src/heavy.rs",
  "DEV-06": "automated twin: unit test slots_are_exclusive_and_taken_over_when_stale in xtask/src/heavy.rs",
  "DEV-07": "automated twin: unit tests slot_counts and slots_are_exclusive_and_taken_over_when_stale in xtask/src/heavy.rs",
  "DEV-08": "automated twin: unit test sizes in xtask/src/clean.rs",
  "DEV-09": "automated twin: unit test staleness_by_age in xtask/src/clean.rs",
  "DEV-10": "removes worktrees and a database of the repository: run by hand",
  "HOST-01": "automated twin: groups_in_the_context in crates/kernel/tests/host_ops.rs",
  "HOST-02": "automated twin: groups_in_the_context in crates/kernel/tests/host_ops.rs",
  "HOST-03": "automated twin: notify_the_caller_and_the_viewers_of_an_item in crates/kernel/tests/host_ops.rs",
  "HOST-04": "automated twin: notify_the_caller_and_the_viewers_of_an_item in crates/kernel/tests/host_ops.rs",
  "HOST-05": "automated twin: notify_the_caller_and_the_viewers_of_an_item in crates/kernel/tests/host_ops.rs",
  "HOST-06": "automated twin: notify_needs_the_permission_in_the_manifest in crates/kernel/tests/host_ops.rs",
  "HOST-07": "automated twin: notify_limits_and_links in crates/kernel/tests/host_ops.rs",
  "HOST-08": "automated twin: notify_limits_and_links in crates/kernel/tests/host_ops.rs",
  "HOST-09": "automated twin: notify_never_crosses_tenants in crates/kernel/tests/host_ops.rs"
}

const checks: L.Check[] = [
  {
    id: 'PERF-01',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-01'] }
    },
  },
  {
    id: 'PERF-02',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-02'] }
    },
  },
  {
    id: 'PERF-03',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-03'] }
    },
  },
  {
    id: 'PERF-04',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-04'] }
    },
  },
  {
    id: 'PERF-05',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-05'] }
    },
  },
  {
    id: 'PERF-06',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-06'] }
    },
  },
  {
    id: 'PERF-07',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-07'] }
    },
  },
  {
    id: 'PERF-08',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-08'] }
    },
  },
  {
    id: 'PERF-09',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-09'] }
    },
  },
  {
    id: 'PERF-10',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-10'] }
    },
  },
  {
    id: 'PERF-11',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-11'] }
    },
  },
  {
    id: 'PERF-12',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-12'] }
    },
  },
  {
    id: 'PERF-13',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['PERF-13'] }
    },
  },
  {
    id: 'QA-01',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-01'] }
    },
  },
  {
    id: 'QA-02',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-02'] }
    },
  },
  {
    id: 'QA-03',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-03'] }
    },
  },
  {
    id: 'QA-04',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-04'] }
    },
  },
  {
    id: 'QA-05',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-05'] }
    },
  },
  {
    id: 'QA-06',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-06'] }
    },
  },
  {
    id: 'QA-07',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-07'] }
    },
  },
  {
    id: 'QA-08',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-08'] }
    },
  },
  {
    id: 'QA-09',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-09'] }
    },
  },
  {
    id: 'QA-10',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-10'] }
    },
  },
  {
    id: 'QA-11',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-11'] }
    },
  },
  {
    id: 'QA-12',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-12'] }
    },
  },
  {
    id: 'QA-13',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-13'] }
    },
  },
  {
    id: 'QA-14',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-14'] }
    },
  },
  {
    id: 'QA-15',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-15'] }
    },
  },
  {
    id: 'QA-16',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-16'] }
    },
  },
  {
    id: 'QA-17',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['QA-17'] }
    },
  },
  {
    id: 'DEV-01',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['DEV-01'] }
    },
  },
  {
    id: 'DEV-02',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['DEV-02'] }
    },
  },
  {
    id: 'DEV-03',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['DEV-03'] }
    },
  },
  {
    id: 'DEV-04',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['DEV-04'] }
    },
  },
  {
    id: 'DEV-05',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['DEV-05'] }
    },
  },
  {
    id: 'DEV-06',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['DEV-06'] }
    },
  },
  {
    id: 'DEV-07',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['DEV-07'] }
    },
  },
  {
    id: 'DEV-08',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['DEV-08'] }
    },
  },
  {
    id: 'DEV-09',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['DEV-09'] }
    },
  },
  {
    id: 'DEV-10',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['DEV-10'] }
    },
  },
  {
    id: 'HOST-01',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['HOST-01'] }
    },
  },
  {
    id: 'HOST-02',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['HOST-02'] }
    },
  },
  {
    id: 'HOST-03',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['HOST-03'] }
    },
  },
  {
    id: 'HOST-04',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['HOST-04'] }
    },
  },
  {
    id: 'HOST-05',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['HOST-05'] }
    },
  },
  {
    id: 'HOST-06',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['HOST-06'] }
    },
  },
  {
    id: 'HOST-07',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['HOST-07'] }
    },
  },
  {
    id: 'HOST-08',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['HOST-08'] }
    },
  },
  {
    id: 'HOST-09',
    async run() {
      return { status: 'NOT VERIFIABLE', note: REASON['HOST-09'] }
    },
  },
]

export default checks
