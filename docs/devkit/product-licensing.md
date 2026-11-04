# Licensing and responsibilities of a product's publisher

> **Draft, decision D9 of the plan (2026-11-04).** This is the text the project proposes. It is not legal advice: whoever is
> entitled to must read it before it is published as terms.

## 1. What you may redistribute

- The SDK, the templates, the examples and these documents are under the **Apache-2.0** licence.
- The **compiled base** (the server and desktop executables, the Docker image) is also under Apache-2.0: you may redistribute it
  inside your product, unchanged, with the licence text and the notices of the third-party components that come with the kit
  (`THIRD-PARTY-NOTICES`). You may not remove them.
- The official plugins are Apache-2.0 and are kept in your product with their own signature.
- You may not claim the base as your own work, and a modified base is not Mosaikit (the kernel is not forked: a product
  changes brand, plugins and policy only).

## 2. Name and brand

- Your product has **its own name and brand** (`brand.toml`). Users see yours.
- The About data keep **«Powered by Mosaikit»** with the version of the base. Do not hide it.
- You may not use the name *Mosaikit* as the name of your product, or present your product as an official one of the project.
  The names and logos of the project stay with it.

## 3. Who supports what

| Mosaikit (the project) | You (the publisher) |
|---|---|
| The base: kernel, plugin API, package format, the official plugins, the tools of the kit | Your plugins, brand, defaults, data and deployment |
| Fixes and security patches of the base, published with a changelog | Support to your users; finding out whether a problem is in your part or in the base |
| The documents of the kit | The documents of your product |

A problem you trace to the base is reported with the About data of the product, the log and the steps to repeat it.

## 4. Upgrades and security patches

- The plugin API changes only with a new major version or in an additive way; deprecated keys stay for one major version.
- At **every security patch of the base** you rebuild your product on the patched base and ship it within **30 days**
  (the term proposed here; the owner of the project sets it).
- Your release states the range of the base it works with (`[product] base`). A product outside the range does not start.

## 5. Your own plugins and the signature

You sign your plugins with your own key and keep it private. You do not ask users to trust any other key than yours
and the official one. A release never carries an unsigned plugin.
