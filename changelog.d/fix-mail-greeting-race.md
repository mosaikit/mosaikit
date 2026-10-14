### Fixed

- A confirmation mail could wait until its timeout, then answer 503, on a working mail server (#94):
  sent from the worker thread of a request, the mail client could read the greeting of the server
  before it was listening on the new connection, and dropped it. Mails now start on an event loop of
  Vert.x, where this cannot happen (MK-048).
