# mosaikit-product

The command-line tool of the publishers of **products** (distributions) built on [Mosaikit](https://github.com/mosaikit): a
brand, a choice of official plugins, their own plugins and a policy (defaults, locked settings, first start), on a compiled
base. No source of Mosaikit and no compilation of the kernel.

```text
mosaikit-product new acme-maps                 a product folder (distribution.toml, branding/, plugins/, shared/, tests/, CI, README)
mosaikit-product validate [dir]                distribution.toml, brand, the own plugins (strict), the policy tables (by the base: needs mosaikit-server)
mosaikit-product dev [dir] [--base kit]        the base in the developer profile with the brand, the policy and the plugins of the product
mosaikit-product build desktop --base <kit>    the executable of the base renamed, signed registry, brand, mosaikit.toml, START.txt
mosaikit-product build docker  --base <kit> --base-image mosaikit:1.0.0 [--build]   Dockerfile on the base image, compose file
mosaikit-product build k8s                   kustomize overlay with the image of the product (manifests of the base built in; --base-k8s <folder> replaces them)
mosaikit-product sign file.mskp --key k        sign a package again with the key of the product
mosaikit-product doctor                        what the tool needs
```

The own plugins are signed with the key of the product (`--key`, `MOSAIKIT_SIGNING_KEY`, `MOSAIKIT_SIGNING_KEY_FILE`, else the
development key of `mosaikit-plugin`); the official plugins the product keeps are copied with their own signature from the registry
of the base, and the release trusts both keys. The name, version and icon of the Windows executable are set with `rcedit`
when it is on the PATH.

See `docs/devkit/building-an-application.md`.
