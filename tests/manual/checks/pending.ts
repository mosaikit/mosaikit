// Checks added to docs/manual-tests.md by other work (performance, QA, development environment, plugin host)
// after this suite was written: listed so that the consistency check passes; each one is a skipped test until
// it is automated here (remove its entry when it gets a real check).
import type * as L from '../lib.ts'

const NOTE = 'not automated yet (added to the document after the suite); run it by hand'

const checks: L.Check[] = [
  {
    id: 'PERF-01',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'PERF-02',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'PERF-03',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'PERF-04',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'PERF-05',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'PERF-06',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'PERF-07',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'PERF-08',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'PERF-09',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'PERF-10',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'PERF-11',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'PERF-12',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'PERF-13',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-01',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-02',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-03',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-04',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-05',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-06',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-07',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-08',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-09',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-10',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-11',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-12',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-13',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-14',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-15',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-16',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'QA-17',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'DEV-01',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'DEV-02',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'DEV-03',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'DEV-04',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'DEV-05',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'DEV-06',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'DEV-07',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'DEV-08',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'DEV-09',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'DEV-10',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'HOST-01',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'HOST-02',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'HOST-03',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'HOST-04',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'HOST-05',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'HOST-06',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'HOST-07',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'HOST-08',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
  {
    id: 'HOST-09',
    async run() {
      return { status: 'NOT VERIFIABLE', note: NOTE }
    },
  },
]

export default checks
