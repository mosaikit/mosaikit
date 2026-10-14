### Security

- Behind a reverse proxy that terminates TLS, the kernel saw `http` and set the session cookie and
  the cookie of "remember me" without `Secure` (#97). The cookies now follow the scheme forwarded by
  a trusted proxy (`quarkus.http.proxy.*`); Docker Compose believes `X-Forwarded-Proto` from
  `MOSAIKIT_TRUSTED_PROXIES` only, the Helm chart from the ingress (`proxy.trustedProxies`, required
  with a `NodePort` or `LoadBalancer` service), and the installation and portable distributions
  carry the settings commented. `mosaikit.accounts.secure-cookies=true` makes the cookies always
  `Secure`. See "Behind a reverse proxy" in the installation guide.
