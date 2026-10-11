// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.config;

import io.smallrye.config.ConfigMapping;
import io.smallrye.config.WithDefault;
import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Optional;

/** Configuration of the kernel, under the {@code mosaikit} prefix. */
@ConfigMapping(prefix = "mosaikit")
public interface KernelConfig {

    /** Plugin installation. */
    Plugins plugins();

    /** First start of an empty installation. */
    Bootstrap bootstrap();

    /** Federated sign-in through Keycloak (MK-012). */
    Identity identity();

    /** Catalogs of plugins to install from (MK-022). */
    Marketplace marketplace();

    /** The assistant that uses the tools of the plugins (MK-024). */
    Assistant assistant();

    /** The look of the user interface. */
    Ui ui();

    /** Local accounts. */
    Accounts accounts();

    /** Settings of local accounts. */
    interface Accounts {

        /** How long "remember me" keeps a person signed in on a browser, unless they sign out. */
        @WithDefault("30d")
        Duration rememberFor();

        /**
         * Whether self-registered people confirm their email address with a link sent by mail
         * before they sign in. The mail server is set with {@code quarkus.mailer.*}.
         */
        @WithDefault("true")
        boolean confirmEmail();

        /** How long the link that confirms an email address works. */
        @WithDefault("24h")
        Duration confirmationValidFor();
    }

    /**
     * The address of the installation as people reach it, such as {@code https://mosaikit.example.org},
     * for the links in mails. When absent, the address of the request is used.
     */
    Optional<URI> publicUrl();

    /** Settings of the user interface. */
    interface Ui {

        /**
         * The theme of the shell: {@code mosaikit}, {@code pa} for public administrations in the style
         * of Bootstrap Italia (AgID design guidelines), or the identifier of an active theme plugin
         * (MK-028); the shell uses {@code mosaikit} when the theme is not available.
         */
        @WithDefault("mosaikit")
        String theme();
    }

    /**
     * A language model behind an OpenAI-compatible chat completions API, such as a local Ollama
     * ({@code http://localhost:11434/v1}), vLLM or a hosted service. Without a URL there is no
     * assistant; MCP clients can still use the tools.
     */
    interface Assistant {

        /** Base URL of the API, the one that {@code /chat/completions} is relative to. */
        Optional<URI> url();

        /** Model to use. */
        @WithDefault("llama3.1")
        String model();

        /** API key, sent as a bearer token, when the service needs one. */
        Optional<String> apiKey();

        /** Most rounds of tool calls for one question. */
        @WithDefault("6")
        int maxSteps();

        /** How long one answer of the model may take. */
        @WithDefault("120s")
        Duration timeout();
    }

    /** Catalogs of plugins: directories with a signed {@code index.json}, local or over HTTPS. */
    interface Marketplace {

        /**
         * Directories of catalogs, such as {@code https://plugins.example.org/stable/}, {@code
         * file:/media/usb/mosaikit-plugins/} for an offline transfer, or {@code catalog/}, a directory
         * of the installation.
         */
        Optional<List<URI>> sources();

        /** Largest package that the kernel downloads or accepts, in bytes. */
        @WithDefault("268435456")
        long maxPackageBytes();
    }

    /** Federated identity settings. Without a Keycloak URL, only local accounts sign in. */
    interface Identity {

        /**
         * Public base URL of Keycloak, for example {@code https://auth.example.org}. The realm of
         * an organization is {@code <url>/realms/<realm>}; its tokens must be issued with this URL.
         */
        Optional<URI> keycloakUrl();

        /**
         * URL at which the kernel itself reaches Keycloak, when it differs from the public one:
         * for example {@code http://keycloak:8080} in Docker Compose, where browsers use {@code
         * http://localhost:8180}. Tokens must still carry the public URL as issuer. Keycloak must
         * then give back-channel URLs for the host of each request ({@code
         * hostname-backchannel-dynamic}).
         */
        Optional<URI> keycloakInternalUrl();

        /**
         * Service account with which the kernel creates the realm of a new organization (MK-018):
         * a confidential client of the {@code master} realm with the {@code admin} role. Without
         * it, realms are created by hand.
         */
        Optional<Admin> admin();

        /** Credentials of the Keycloak administration client. */
        interface Admin {

            /** Client identifier in the {@code master} realm. */
            String clientId();

            /** Client secret. */
            String clientSecret();
        }

        /** Client of the kernel UI, created with this identifier in every realm. */
        @WithDefault("mosaikit")
        String clientId();

        /**
         * Domain of the installation, for example {@code mosaikit.example.org}: the organization
         * of a request to {@code acme.mosaikit.example.org} is the one with slug {@code acme}.
         * When absent, the organization is chosen from the email domain or the token issuer.
         */
        Optional<String> domain();

        /** How long the identity settings of organizations are cached. */
        @WithDefault("30s")
        Duration cacheTtl();
    }

    /** Plugin installation settings. */
    interface Plugins {

        /** Directory that holds one sub-directory per installed plugin. */
        @WithDefault("plugins")
        Path directory();

        /**
         * The providers directory of the kernel, set by the launcher (the {@code mosaikit} launcher) that
         * loads the Java code of plugins. When absent, plugins that bring Java code are not
         * activated.
         */
        Optional<Path> providersDirectory();

        /**
         * Where plugin packages ({@code *.zip}) are unpacked. Set by the launcher to a directory
         * of the kernel; when absent, {@code .packages} in the plugins directory.
         */
        Optional<Path> packagesDirectory();

        /**
         * Directory of the public keys of trusted plugin publishers ({@code *.pub.pem}, MK-013).
         * The launcher reads the same directory, relative to the installation.
         */
        @WithDefault("config/trusted-keys")
        Path trustedKeysDirectory();

        /**
         * {@code optional}: signed packages are checked and refused when they were changed, and
         * unsigned plugins are accepted. {@code required}: only packages signed with a trusted
         * key are accepted.
         */
        @WithDefault("optional")
        String signatures();

        /**
         * How the shell runs the frontends of plugins whose publisher is not verified (MK-014):
         * {@code iframe} isolates them in a sandboxed iframe that reaches the shell only through
         * the bridge declared in their manifest; {@code module} loads them like verified ones.
         * Frontends that declare {@code isolation: iframe} always run in an iframe.
         */
        @WithDefault("iframe")
        String unverifiedFrontends();

        /**
         * Watches the plugins directory and reads it again when a file changes, and lets the shell
         * reload its page then: changed frontends show at once. Java code and schemas still wait
         * for the next start. On in development mode.
         */
        @WithDefault("false")
        boolean watch();
    }

    /** Settings used only when the installation has no account yet. */
    interface Bootstrap {

        /** Username of the platform administrator created at first start. */
        @WithDefault("admin")
        String adminUsername();

        /**
         * Password of the platform administrator created at first start. When absent, no account
         * is created and a warning is logged.
         */
        Optional<String> adminPassword();
    }
}
