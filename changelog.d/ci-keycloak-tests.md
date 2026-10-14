### Fixed

- Ending the current session from the settings deletes its cookies with `Secure` when the cookies of
  the kernel are secure, as signing out does (issue #124). The tests with Keycloak (federated
  sign-in, realms, the sessions of a realm) run in the CI of every pull request, against a Keycloak
  started by the job `keycloak`.
