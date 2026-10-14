### Security

- The real-time connection of a page stayed open after its session ended, and kept receiving the
  events of the organization until it disconnected (MK-125). Signing out, ending a session in the
  settings, a suspension and the removal from an organization now close it, with the code `4401`, at
  once on the kernel that ended the session and within 5 seconds on the others; the shell does not
  connect again with an ended session.
