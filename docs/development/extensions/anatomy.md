# Anatomy

```
my-extension/
├── manifest.yaml     # the contract (JSON Schema in sdk/java)
├── web/index.js      # ES module exporting the extension frontend (optional)
├── lib/my-extension.jar # Java code, built from the sources of the extension (optional)
└── db/               # Flyway migrations of the extension schema p_<name> (optional)
```
