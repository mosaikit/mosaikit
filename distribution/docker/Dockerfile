# SPDX-FileCopyrightText: 2026 Massimo Antonini
# SPDX-License-Identifier: MPL-2.0
#
# Image of the installation built by ./mvnw install (target/dist/mosaikit), used by compose.yaml.
# The image published by the release is built from the sources instead
# (distribution/docker/Containerfile in the repository); both have the same layout.
FROM eclipse-temurin:25-jre-noble
LABEL org.opencontainers.image.title="Mosaikit" \
      org.opencontainers.image.licenses="MPL-2.0"
ENV LANG=C.UTF-8 \
    JAVA_OPTS="-XX:MaxRAMPercentage=75 -Djava.util.logging.manager=org.jboss.logmanager.LogManager"
WORKDIR /opt/mosaikit
COPY --chown=185 mosaikit/ ./
# files/: the files of extensions (MK-041), a volume in compose.yaml, owned by the kernel.
RUN chmod 755 mosaikit && mkdir -p files && chown 185 files
USER 185
EXPOSE 8080
ENTRYPOINT ["/opt/mosaikit/mosaikit", "start"]
