# External services from the browser

The content security policy of the shell lets the browser contact the installation only. A
frontend that reads an external service directly, such as tiles of a map server or the data of an
open API that allows cross-origin calls, works only for the origins that the platform administrators
list in **External origins** (MK-128): they are added to `connect-src` and `img-src`, never to
scripts, styles or frames, and the service must answer the CORS request of the browser. Name in the
documentation of the extension the origins it contacts; anything else goes through the backend of
the extension.
