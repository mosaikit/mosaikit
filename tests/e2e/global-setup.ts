import fs from 'node:fs'
import { ADMIN_STATE } from './specs/support'

// A new run is a new installation: the second factor of the previous one is no longer valid.
export default function globalSetup() {
  fs.rmSync(ADMIN_STATE, { force: true })
}
