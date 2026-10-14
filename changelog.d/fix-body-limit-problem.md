### Fixed

- A request whose body is larger than `quarkus.http.limits.max-body-size` got 413 with an empty
  body, so an installation without a gateway showed no reason (#115): it now gets 413 as an
  `application/problem+json` detail that names the limit and the setting (MK-010).
