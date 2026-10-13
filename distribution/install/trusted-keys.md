# Trusted extension publishers

This directory holds the public keys (`<name>.pub.pem`) of the publishers whose extension packages
this installation trusts (MK-013). The key that signed the packages of this distribution is
already here.

- A package signed with one of these keys shows its publisher as verified.
- A package whose content does not match its signature is always refused.
- With `mosaikit.extensions.signatures=required` in `config/application.properties`, only packages
  signed with one of these keys are accepted.

To trust another publisher, copy its `.pub.pem` file here and restart Mosaikit. See
`docs/guide/extensions.md` in the Mosaikit repository.
