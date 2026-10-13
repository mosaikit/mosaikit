# Reference versions

Checked on 29 September 2026. Renovate proposes updates; changing a major version needs an ADR.

| Area | Version |
|---|---|
| Java | 25 LTS |
| Maven | 3.9.12 through Maven Wrapper 3.3.4 |
| Quarkus | 3.39.x, then 3.40 LTS, then Quarkus 4 (kernel code avoids Panache, the Vert.x event bus and framework types in `kernel-api`) |
| Hibernate ORM / Jakarta Data | 7.4 / 1.0 (from the Quarkus BOM) |
| Jackson | 2.22.3, over the 2.22.2 of the Quarkus BOM for CVE-2026-91776 and CVE-2026-91777 |
| PostgreSQL | 18 |
| Keycloak | 26.7 (federation, next iteration) |
| Node.js | 24 LTS, 26 LTS from 28 October 2026 |
| TypeScript | 6.0 (TypeScript 7 as soon as typescript-eslint supports it; see ADR-0007) |
| Lit / Vite / Vitest | 3.3 / 8 / 5 |
| JUnit / AssertJ / ArchUnit | 6 (from the Quarkus BOM) / 3.27 / 1.5 (`archunit-junit6`) |
| SonarQube | SonarQube Cloud (Free plan); SonarQube Server 2026.5 LTA, Developer edition or higher, if self-hosted |
| Helm | 4.3 |
| Container base | Eclipse Temurin 25 JRE on Ubuntu Noble (`eclipse-temurin:25-jre-noble`); UBI 10 minimal when runtime images are confirmed |
