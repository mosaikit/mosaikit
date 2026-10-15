# Signing a package

Installations can refuse packages that are not signed by a publisher they trust (MK-013,
[ADR-0014](../../adr/0014-signed-plugin-packages.md)). Sign every package you publish with the tool in
the JAR of the Java extension API:

```bash
API=mosaikit-kernel-api-0.1.0.jar
TOOL=dev.mosaikit.kernel.api.signature.PackageSigningTool
java -cp $API $TOOL keygen ~/keys acme            # once: acme.pub.pem and acme.key.pem (secret)
java -cp $API $TOOL sign ~/keys/acme target/my-extension-1.0.0.zip
java -cp $API $TOOL verify ~/keys target/my-extension-1.0.0.zip
```

Give `acme.pub.pem` to the administrators: they copy it into `config/trusted-keys` of their
installation. Signing again replaces the signature; changing any file afterwards makes the package
refused. A registry can store the signed zip as an OCI artifact as it is:

```bash
oras push registry.example.org/extensions/my-extension:1.0.0 \
  my-extension-1.0.0.zip:application/vnd.mosaikit.extension.v1+zip
oras pull registry.example.org/extensions/my-extension:1.0.0 -o extensions/
```
