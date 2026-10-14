// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.config;

import io.quarkus.runtime.configuration.MemorySize;
import io.smallrye.config.ConfigMapping;
import io.smallrye.config.WithDefault;
import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Configuration of the kernel, under the {@code mosaikit} prefix. */
@ConfigMapping(prefix = "mosaikit")
public interface KernelConfig {

    /** Extension installation. */
    Extensions extensions();

    /** First start of an empty installation. */
    Bootstrap bootstrap();

    /** Federated sign-in through Keycloak (MK-012). */
    Identity identity();

    /** The content security policy of the shell (MK-128). */
    ContentSecurityPolicy contentSecurityPolicy();

    /** Catalogs of extensions to install from (MK-022). */
    Marketplace marketplace();

    /** The assistant that uses the tools of the extensions (MK-024). */
    Assistant assistant();

    /** The look of the user interface. */
    Ui ui();

    /** Local accounts. */
    Accounts accounts();

    /** Sharing of the resources of extensions (MK-055). */
    Sharing sharing();

    /** The database of the installation. */
    Database database();

    /** Settings of the database. */
    interface Database {

        /**
         * Whether requests run as the member role of the installation, so that the row-level security
         * policies of extensions apply (MK-019). Read by {@code RowSecurity}.
         */
        @WithDefault("true")
        boolean rowSecurity();

        /** The login of external services on the published views (MK-123). */
        PublishedViews publishedViews();

        /** Settings of the published views. */
        interface PublishedViews {

            /** A login the kernel creates at start, which reads the published views and nothing else. */
            Optional<String> login();

            /** Its password, from a secret: the kernel never logs it. */
            Optional<String> password();
        }
    }

    /** Settings of sharing. */
    interface Sharing {

        /**
         * The longest validity of a link to a resource: every link expires, at the latest this long
         * after it is made ({@code mosaikit.sharing.link-max-validity}).
         */
        @WithDefault("30d")
        Duration linkMaxValidity();
    }

    /** The encrypted store of credentials for extensions (MK-062). */
    Secrets secrets();

    /**
     * The master keys of the store of credentials (MK-062). Each credential is encrypted with a data
     * key of its own, and the data key with the current master key, which never goes in the
     * database. Without a master key the store is disabled: the kernel starts, and the endpoints of
     * credentials answer 503.
     */
    interface Secrets {

        /**
         * The current master key: 32 random bytes in base64, such as the output of {@code openssl
         * rand -base64 32}. Prefer an environment variable or a key file to a file of settings.
         */
        Optional<String> masterKey();

        /** A file that holds the current master key in base64, instead of {@code master-key}. */
        Optional<Path> masterKeyFile();

        /**
         * Former master keys, in base64, kept during a rotation to read the credentials not yet
         * encrypted again with the current key. New writes always use the current key.
         */
        Optional<List<String>> previousKeys();
    }

    /** The audit log (MK-059). */
    Audit audit();

    /** The files of extensions (MK-041). */
    Files files();

    /** Where and how the kernel keeps the files of extensions (MK-041, ADR-0029). */
    interface Files {

        /**
         * The store of the files: {@code filesystem}, a directory of the server, or {@code s3}, a
         * bucket of an S3-compatible object store.
         */
        @WithDefault("filesystem")
        Store store();

        /**
         * The directory of the {@code filesystem} store, relative to the working directory of the
         * kernel when not absolute.
         */
        @WithDefault("files")
        Path directory();

        /**
         * The largest file, such as {@code 512M} or {@code 2G}. An upload through the REST API is also
         * bound by {@code quarkus.http.limits.max-body-size} (10M by default), which an installation
         * raises with it.
         */
        @WithDefault("10M")
        MemorySize maxSize();

        /**
         * The longest validity of a signed link to files (MK-093): every link expires, at the latest
         * this long after it is made.
         */
        @WithDefault("7d")
        Duration linkMaxValidity();

        /**
         * The key that signs the links to files (MK-093): at least 32 random bytes in base64, such as
         * the output of {@code openssl rand -base64 32}. Absent, the key is derived from the master
         * key of the store of credentials ({@code mosaikit.secrets.master-key}); without either, no
         * link can be made.
         */
        Optional<String> linkKey();

        /**
         * The former keys of a rotation of {@code link-key}, in base64: links signed with them are
         * still accepted until they expire; new links are signed with {@code link-key}.
         */
        Optional<List<String>> linkPreviousKeys();

        /** The {@code s3} store. */
        S3 s3();

        /** The stores of files. */
        enum Store {
            FILESYSTEM,
            S3
        }

        /** Settings of an S3-compatible object store. */
        interface S3 {

            /**
             * The URL of the store, such as {@code https://s3.example.org} for a store on premises;
             * absent for Amazon S3, whose URL follows from the region.
             */
            Optional<URI> endpoint();

            /** The region of the bucket; any value for a store that has no regions. */
            @WithDefault("us-east-1")
            String region();

            /** The bucket of the files, which must exist. */
            Optional<String> bucket();

            /**
             * Whether the bucket goes in the path of the URL ({@code https://s3.example.org/bucket})
             * rather than in its host name, as most stores on premises need.
             */
            @WithDefault("false")
            boolean pathStyle();

            /**
             * The access key; absent to use the credentials of the environment of the kernel (the
             * variables {@code AWS_ACCESS_KEY_ID} and {@code AWS_SECRET_ACCESS_KEY}, a profile, the
             * role of the machine).
             */
            Optional<String> accessKeyId();

            /** The secret of the access key, from a secret: the kernel never logs it. */
            Optional<String> secretAccessKey();
        }
    }

    /** The quotas of organizations (MK-076). */
    Quotas quotas();

    /**
     * The limits that every organization has unless a platform administrator sets others for it
     * (MK-076). Without a limit, a measure has none.
     */
    interface Quotas {

        /**
         * The space each organization keeps, such as {@code 10G}: its files and the space that
         * extensions report for their resources.
         */
        Optional<MemorySize> storage();

        /**
         * The limit of each measure of extensions, by its identifier {@code <extension>/<measure>}:
         * per month for a counter, at any time for a gauge.
         */
        Map<String, Long> limits();
    }

    /** Events of the platform for the Java code of extensions (MK-085). */
    Events events();

    /** Settings of the events of the platform. */
    interface Events {

        /** How often each kernel looks for events to deliver. */
        @WithDefault("2s")
        Duration pollInterval();

        /** How long the first retry of a failed delivery waits; each next one waits twice as long, up to an hour. */
        @WithDefault("10s")
        Duration retryDelay();

        /** How many times an event is given to a subscriber before the kernel gives up on it. */
        @WithDefault("10")
        int maxAttempts();

        /** How long events stay once every subscriber received them, or was given up on. */
        @WithDefault("7d")
        Duration keep();
    }

    /** Settings of the audit log. */
    interface Audit {

        /**
         * The shortest retention of the entries of the audit log: organizations may keep their entries
         * longer, never less. Rounded up to whole days.
         */
        @WithDefault("365d")
        Duration minRetention();

        /** How often each kernel deletes the entries older than their retention. */
        @WithDefault("6h")
        Duration retentionCheck();
    }

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

        /**
         * How long the link works with which a person sets the password of an account that an
         * administrator created (MK-048). The link works once; a new one replaces it.
         */
        @WithDefault("7d")
        Duration setPasswordValidFor();

        /**
         * How long a session of the shell opened with a password lasts without requests (MK-125). At
         * least one minute.
         */
        @WithDefault("8h")
        Duration sessionTimeout();

        /**
         * How long a session lasts at most, whatever its activity; "remember me" then opens a new one.
         * The record of an ended session of a realm is kept at least this long, so that the tokens the
         * realm still refreshes for it are refused. At least one minute.
         */
        @WithDefault("24h")
        Duration sessionMaxLife();

        /**
         * How long a kernel keeps what it read about a session before reading it again. A session ended
         * on this kernel is refused at once; one ended on another kernel of the same installation is
         * refused after at most this long. {@code 0s} reads the database on every request.
         */
        @WithDefault("5s")
        Duration sessionCache();

        /**
         * How long a personal access key lasts at most from its creation (MK-060): people choose a
         * shorter expiry, never a longer one, and a key created without one lasts this long. A key
         * revoked on another kernel of the same installation is refused after at most {@link
         * #sessionCache()}.
         */
        @WithDefault("365d")
        Duration accessKeyMaxValidity();

        /**
         * How long the kernel waits for the mail server to take a mail, such as the confirmation
         * link, in all. The time is split in two attempts: when the first one times out, the mail is
         * sent once more on another connection. The mail is sent outside of any database
         * transaction; when the server does not take it in time, the person gets an answer that the
         * mail could not be sent, and can ask for it again.
         */
        @WithDefault("15s")
        Duration mailTimeout();

        /**
         * Whether the cookies of the kernel (the session of the shell and "remember me") always carry
         * {@code Secure}. When {@code false} they carry it when the request is HTTPS as the kernel
         * sees it: the scheme of the connection, or the one forwarded by a trusted reverse proxy
         * ({@code quarkus.http.proxy.*}). {@code true} for an installation reached only over HTTPS,
         * whatever the proxy in front of it forwards.
         */
        @WithDefault("false")
        boolean secureCookies();
    }

    /**
     * The address of the installation as people reach it, such as {@code https://mosaikit.example.org},
     * for the links in mails. When absent, the address of the request is used.
     */
    Optional<URI> publicUrl();

    /**
     * The language of the installation, {@code en} or {@code it}: the mails of the kernel to a person
     * who chose no language, and who does not ask in one, are written in it (#95). Another value
     * counts as {@code en}.
     */
    @WithDefault("en")
    String language();

    /** Settings of the user interface. */
    interface Ui {

        /**
         * The theme of the shell: {@code mosaikit}, {@code pa} for public administrations in the style
         * of Bootstrap Italia (AgID design guidelines), or the identifier of an active theme extension
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

    /** Catalogs of extensions: directories with a signed {@code index.json}, local or over HTTPS. */
    interface Marketplace {

        /**
         * Directories of catalogs, such as {@code https://extensions.example.org/stable/}, {@code
         * file:/media/usb/mosaikit-extensions/} for an offline transfer, or {@code catalog/}, a directory
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

    /** Extension installation settings. */
    interface Extensions {

        /** Directory that holds one sub-directory per installed extension. */
        @WithDefault("extensions")
        Path directory();

        /**
         * The providers directory of the kernel, set by the launcher (the {@code mosaikit} launcher) that
         * loads the Java code of extensions. When absent, extensions that bring Java code are not
         * activated.
         */
        Optional<Path> providersDirectory();

        /**
         * Where extension packages ({@code *.zip}) are unpacked. Set by the launcher to a directory
         * of the kernel; when absent, {@code .packages} in the extensions directory.
         */
        Optional<Path> packagesDirectory();

        /**
         * Directory of the public keys of trusted extension publishers ({@code *.pub.pem}, MK-013).
         * The launcher reads the same directory, relative to the installation.
         */
        @WithDefault("config/trusted-keys")
        Path trustedKeysDirectory();

        /**
         * {@code optional}: signed packages are checked and refused when they were changed, and
         * unsigned extensions are accepted. {@code required}: only packages signed with a trusted
         * key are accepted.
         */
        @WithDefault("optional")
        String signatures();

        /**
         * How the shell runs the frontends of extensions whose publisher is not verified (MK-014):
         * {@code iframe} isolates them in a sandboxed iframe that reaches the shell only through
         * the bridge declared in their manifest; {@code module} loads them like verified ones.
         * Frontends that declare {@code isolation: iframe} always run in an iframe.
         */
        @WithDefault("iframe")
        String unverifiedFrontends();

        /**
         * Watches the extensions directory and reads it again when a file changes, and lets the shell
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

    /** The content security policy of the shell and of the other answers of the kernel (MK-128). */
    interface ContentSecurityPolicy {

        /** Whether the kernel sends the policy; on in production, off in development and tests. */
        @WithDefault("false")
        boolean enabled();

        /**
         * External origins that the browser may contact for images, data and tiles, as {@code
         * scheme://host[:port]}, in addition to those that platform administrators list; added to {@code
         * connect-src} and {@code img-src}. The kernel does not start with one it does not accept.
         */
        Optional<List<String>> allowedOrigins();
    }
}
