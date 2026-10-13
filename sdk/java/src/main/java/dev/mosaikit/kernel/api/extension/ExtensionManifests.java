// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import dev.mosaikit.kernel.api.sharing.SubjectKind;
import dev.mosaikit.kernel.api.version.InvalidVersionException;
import dev.mosaikit.kernel.api.version.Version;
import dev.mosaikit.kernel.api.version.VersionRange;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Function;
import java.util.regex.Pattern;

/**
 * Reads and validates extension manifests.
 *
 * <p>The input is the manifest as a tree of maps, lists and scalars, as produced by any YAML or
 * JSON parser. All violations are collected, so that an extension author can fix them in one pass.
 */
public final class ExtensionManifests {

    /** Reverse-DNS identifier with at least two segments. */
    public static final Pattern ID_PATTERN = Pattern.compile("^[a-z][a-z0-9-]*+(?:\\.[a-z][a-z0-9-]*+)++$");

    /** PostgreSQL identifier reserved to extension schemas. */
    public static final Pattern SCHEMA_PATTERN = Pattern.compile("^ext_[a-z][a-z0-9_]{0,57}$");

    /** Name of an action of an extension (MK-015). */
    public static final Pattern ACTION_PATTERN = Pattern.compile("^[a-z][a-z0-9-]{0,47}$");

    /** Name of a permission of an extension (MK-056), such as {@code create-dashboard}. */
    public static final Pattern PERMISSION_PATTERN = Pattern.compile("^[a-z][a-z0-9-]{0,47}$");

    /** Name of a resource type of an extension (MK-054), such as {@code dashboard}. */
    public static final Pattern RESOURCE_TYPE_PATTERN = Pattern.compile("^[a-z][a-z0-9-]{0,47}$");

    /** Name of a sharing level of a resource type (MK-055), such as {@code view}. */
    public static final Pattern LEVEL_PATTERN = Pattern.compile("^[a-z][a-z0-9-]{0,31}$");

    private static final String ACTIONS = "actions";

    private static final String PERMISSIONS = "permissions";

    private static final String RESOURCES = "resources";

    private static final String TITLE = "title";

    private static final String I18N = "i18n";

    /** Prefixes of the extension points of the kernel, which extensions may not declare. */
    private static final List<String> KERNEL_POINTS = List.of("launcher.", "rail.", "settings.", "shell.", "kernel.");

    private static final String MUST_BE_OBJECT = "must be an object";

    public static final List<String> ACTION_METHODS = List.of("GET", "POST", "PUT", "PATCH", "DELETE");

    /** A color of a theme (MK-028). */
    public static final Pattern COLOR_PATTERN = Pattern.compile("^#[0-9a-fA-F]{6}$");

    /** A font stack of a theme: names, quotes, commas and spaces only. */
    public static final Pattern FONT_PATTERN = Pattern.compile("^[\\w\\s'\",.-]{1,200}$");

    /** The name of the product a theme brings (MK-052): letters, digits, spaces and . &amp; ' -. */
    public static final Pattern PRODUCT_PATTERN =
            Pattern.compile("^(?=.*\\S)[\\p{L}\\p{N} .&'-]{1,60}$", Pattern.UNICODE_CHARACTER_CLASS);

    /** A logo of a theme (MK-052): an SVG or PNG file. */
    public static final Pattern LOGO_PATTERN = Pattern.compile("^[A-Za-z0-9_][A-Za-z0-9_./-]*\\.(svg|png)$");

    /** A language of the texts of a contribution (MK-053), such as {@code it} or {@code pt-BR}. */
    public static final Pattern LANGUAGE_PATTERN = Pattern.compile("^[a-z]{2,3}(-[A-Z][A-Za-z0-9]{1,7})?$");

    /** Name of a collection of documents of an extension (ADR-0031). */
    public static final Pattern COLLECTION_PATTERN = Pattern.compile("^[a-z][a-z0-9-]{0,63}$");

    /** Name of the API of an extension: one path segment under {@code /api/v1/ext/}. */
    public static final Pattern API_PATTERN = Pattern.compile("^[a-z][a-z0-9-]{1,39}$");

    /** Extension point or requirement name, for example {@code launcher.app}. */
    public static final Pattern POINT_PATTERN = Pattern.compile("^[a-z][a-zA-Z0-9-]*+(?:\\.[a-z][a-zA-Z0-9-]*+)++$");

    private static final int MAX_NAME_LENGTH = 80;

    private ExtensionManifests() {}

    /** Parses a manifest tree. */
    public static ManifestParseResult parse(Map<String, ?> tree) {
        Objects.requireNonNull(tree, "tree");
        return new Reader(tree).read();
    }

    /** Collects values and violations while walking the manifest tree. */
    private static final class Reader {

        private final Map<String, ?> tree;
        private final List<ManifestViolation> violations = new ArrayList<>();

        Reader(Map<String, ?> tree) {
            this.tree = tree;
        }

        ManifestParseResult read() {
            String id = requiredText(tree, "id");
            if (id != null && !ID_PATTERN.matcher(id).matches()) {
                violation("id", "must be a lowercase reverse-DNS name, for example dev.example.traffic");
            }
            Version version = convert("version", requiredText(tree, "version"), Version::parse);
            String name = requiredText(tree, "name");
            if (name != null && name.length() > MAX_NAME_LENGTH) {
                violation("name", "must be at most " + MAX_NAME_LENGTH + " characters");
            }
            String description = optionalText(tree, "description");
            Set<ExtensionKind> kinds = readKinds();
            VersionRange platform = convert("platform", requiredText(tree, "platform"), VersionRange::parse);
            Map<String, VersionRange> requires = readRequires();
            FrontendEntry frontend = readFrontend();
            BackendEntry backend = readBackend();
            DatabaseEntry database = readDatabase();
            DataEntry data = readData();
            ThemeEntry theme = readTheme(kinds);
            List<Contribution> contributions = readContributions();
            List<ActionEntry> actions = readActions(backend);
            List<PermissionEntry> permissions = readPermissions();
            List<ResourceTypeEntry> resourceTypes = readResourceTypes();

            if (!violations.isEmpty()) {
                return new ManifestParseResult.Invalid(violations);
            }
            return new ManifestParseResult.Valid(new ExtensionManifest(
                    id,
                    version,
                    name,
                    description,
                    kinds,
                    platform,
                    requires,
                    frontend,
                    backend,
                    database,
                    data,
                    theme,
                    contributions,
                    actions,
                    permissions,
                    resourceTypes));
        }

        /** The permissions of the extension (MK-056): {@code permissions: [{ name, title }]}. */
        private List<PermissionEntry> readPermissions() {
            List<PermissionEntry> permissions = new ArrayList<>();
            Set<String> names = new HashSet<>();
            List<?> list = optionalList(PERMISSIONS, "a list of permissions");
            for (int i = 0; i < list.size(); i++) {
                String field = PERMISSIONS + "[" + i + "]";
                readPermission(field, list.get(i)).ifPresent(permission -> {
                    if (!names.add(permission.name())) {
                        violation(field + ".name", "the permission '" + permission.name() + "' is declared twice");
                    }
                    permissions.add(permission);
                });
            }
            return permissions;
        }

        private Optional<PermissionEntry> readPermission(String field, Object item) {
            Map<String, ?> permission = objectItem(field, item).orElse(null);
            if (permission == null) {
                return Optional.empty();
            }
            int before = violations.size();
            String name = requiredText(permission, "name", field + ".name");
            if (name != null && !PERMISSION_PATTERN.matcher(name).matches()) {
                violation(field + ".name", "must be lowercase letters, digits and '-', for example create-dashboard");
            }
            String title = requiredText(permission, TITLE, field + "." + TITLE);
            String description = optionalText(permission, "description");
            Map<String, Map<String, String>> i18n =
                    readTranslations(field + "." + I18N, permission.get(I18N), Set.of(TITLE, "description"));
            if (violations.size() > before) {
                return Optional.empty();
            }
            return Optional.of(new PermissionEntry(name, title, description, i18n));
        }

        /** The resource types of the extension (MK-054, MK-055), with their sharing levels. */
        private List<ResourceTypeEntry> readResourceTypes() {
            List<ResourceTypeEntry> types = new ArrayList<>();
            Set<String> names = new HashSet<>();
            List<?> list = optionalList(RESOURCES, "a list of resource types");
            for (int i = 0; i < list.size(); i++) {
                String field = RESOURCES + "[" + i + "]";
                readResourceType(field, list.get(i)).ifPresent(type -> {
                    if (!names.add(type.type())) {
                        violation(field + ".type", "the resource type '" + type.type() + "' is declared twice");
                    }
                    types.add(type);
                });
            }
            return types;
        }

        private Optional<ResourceTypeEntry> readResourceType(String field, Object item) {
            Map<String, ?> type = objectItem(field, item).orElse(null);
            if (type == null) {
                return Optional.empty();
            }
            int before = violations.size();
            String name = requiredText(type, "type", field + ".type");
            if (name != null && !RESOURCE_TYPE_PATTERN.matcher(name).matches()) {
                violation(field + ".type", "must be lowercase letters, digits and '-', for example dashboard");
            }
            String title = requiredText(type, TITLE, field + "." + TITLE);
            List<SharingLevelEntry> levels = readLevels(field + ".levels", type.get("levels"));
            Set<SubjectKind> subjects = readSubjects(field + ".subjects", type.get("subjects"));
            Map<String, Map<String, String>> i18n = readTranslations(field + "." + I18N, type.get(I18N), Set.of(TITLE));
            if (violations.size() > before) {
                return Optional.empty();
            }
            return Optional.of(new ResourceTypeEntry(name, title, levels, subjects, i18n));
        }

        private List<SharingLevelEntry> readLevels(String field, Object raw) {
            if (!(raw instanceof List<?> list) || list.isEmpty()) {
                violation(field, "must be a list of at least one level, from the lowest to the highest");
                return List.of();
            }
            List<SharingLevelEntry> levels = new ArrayList<>();
            Set<String> names = new HashSet<>();
            for (int i = 0; i < list.size(); i++) {
                String levelField = field + "[" + i + "]";
                Map<String, ?> level = objectItem(levelField, list.get(i)).orElse(null);
                if (level == null) {
                    continue;
                }
                int before = violations.size();
                String name = requiredText(level, "name", levelField + ".name");
                if (name != null && !LEVEL_PATTERN.matcher(name).matches()) {
                    violation(levelField + ".name", "must be lowercase letters, digits and '-', for example view");
                } else if (name != null && !names.add(name)) {
                    violation(levelField + ".name", "the level '" + name + "' is declared twice");
                }
                String title = requiredText(level, TITLE, levelField + "." + TITLE);
                Map<String, Map<String, String>> i18n =
                        readTranslations(levelField + "." + I18N, level.get(I18N), Set.of(TITLE));
                if (violations.size() == before) {
                    levels.add(new SharingLevelEntry(name, title, i18n));
                }
            }
            return levels;
        }

        private Set<SubjectKind> readSubjects(String field, Object raw) {
            if (raw == null) {
                return SubjectKind.DEFAULT;
            }
            if (!(raw instanceof List<?> list) || list.isEmpty()) {
                violation(field, "must be a list of at least one of person, group, organization, link, public");
                return Set.of();
            }
            Set<SubjectKind> subjects = EnumSet.noneOf(SubjectKind.class);
            for (int i = 0; i < list.size(); i++) {
                Object value = list.get(i);
                Optional<SubjectKind> kind = SubjectKind.fromValue(String.valueOf(value));
                if (kind.isEmpty()) {
                    violation(
                            field + "[" + i + "]",
                            "unknown subject '" + value + "': use person, group, organization, link or public");
                } else if (!subjects.add(kind.get())) {
                    violation(field + "[" + i + "]", "is declared twice");
                }
            }
            return subjects;
        }

        /** The texts of an entry by language (MK-053), only for the attributes of the entry that are texts. */
        private Map<String, Map<String, String>> readTranslations(String field, Object i18n, Set<String> texts) {
            int before = violations.size();
            checkTranslations(field, i18n);
            if (!(i18n instanceof Map<?, ?> languages) || violations.size() > before) {
                return Map.of();
            }
            Map<String, Map<String, String>> result = new LinkedHashMap<>();
            languages.forEach((language, values) -> {
                Map<String, String> translated = new LinkedHashMap<>();
                ((Map<?, ?>) values).forEach((attribute, text) -> {
                    if (texts.contains(String.valueOf(attribute))) {
                        translated.put(String.valueOf(attribute), String.valueOf(text));
                    } else {
                        violation(
                                field + "." + language + "." + attribute,
                                "is not a text of this entry: translate " + String.join(" or ", new TreeSet<>(texts)));
                    }
                });
                result.put(String.valueOf(language), translated);
            });
            return result;
        }

        private List<?> optionalList(String key, String what) {
            Object raw = tree.get(key);
            if (raw == null) {
                return List.of();
            }
            if (!(raw instanceof List<?> list)) {
                violation(key, "must be " + what);
                return List.of();
            }
            return list;
        }

        /** An entry of a list that must be an object; empty, with a violation, otherwise. */
        private Optional<Map<String, ?>> objectItem(String field, Object item) {
            if (!(item instanceof Map<?, ?> raw)) {
                violation(field, MUST_BE_OBJECT);
                return Optional.empty();
            }
            Map<String, Object> result = new LinkedHashMap<>();
            raw.forEach((key, value) -> result.put(String.valueOf(key), value));
            return Optional.of(result);
        }

        private List<ActionEntry> readActions(BackendEntry backend) {
            Object raw = tree.get(ACTIONS);
            if (raw == null) {
                return List.of();
            }
            if (!(raw instanceof List<?> list)) {
                violation(ACTIONS, "must be a list of actions");
                return List.of();
            }
            if (backend == null && !list.isEmpty()) {
                violation(ACTIONS, "need a backend: an action calls the backend API of the extension");
            }
            List<ActionEntry> actions = new ArrayList<>();
            Set<String> names = new HashSet<>();
            for (int i = 0; i < list.size(); i++) {
                readAction("actions[" + i + "]", list.get(i)).ifPresent(action -> {
                    if (!names.add(action.name())) {
                        violation(ACTIONS, "the action '" + action.name() + "' is declared twice");
                    }
                    actions.add(action);
                });
            }
            return actions;
        }

        private Optional<ActionEntry> readAction(String field, Object item) {
            if (!(item instanceof Map<?, ?> raw)) {
                violation(field, MUST_BE_OBJECT);
                return Optional.empty();
            }
            Map<String, Object> action = new LinkedHashMap<>();
            raw.forEach((key, value) -> action.put(String.valueOf(key), value));
            int before = violations.size();
            String name = requiredText(action, "name", field + ".name");
            if (name != null && !ACTION_PATTERN.matcher(name).matches()) {
                violation(field + ".name", "must be lowercase letters, digits and '-', for example create-note");
            }
            String title = requiredText(action, "title", field + ".title");
            String description = optionalText(action, "description");
            String riskText = requiredText(action, "risk", field + ".risk");
            ActionRisk risk =
                    riskText == null ? null : ActionRisk.fromValue(riskText).orElse(null);
            if (riskText != null && risk == null) {
                violation(field + ".risk", "must be read, write or execute");
            }
            InputSchema input = InputSchema.parse(
                    action.getOrDefault("input", Map.of("type", "object")), field + ".input", this::violation);
            Map<String, ?> call = optionalMap(action, "call", field + ".call");
            String method = Objects.requireNonNullElse(optionalText(call, "method"), "POST")
                    .toUpperCase(Locale.ROOT);
            if (!ACTION_METHODS.contains(method)) {
                violation(field + ".call.method", "must be one of " + ACTION_METHODS);
            }
            if (risk == ActionRisk.READ && !method.equals("GET")) {
                violation(field + ".call.method", "a read action calls GET");
            }
            String path = requiredText(call, "path", field + ".call.path");
            if (path != null && (!isSafeRelativePath(path) || path.contains("?") || path.contains("#"))) {
                violation(field + ".call.path", "must be a path relative to the API of the extension, without '..'");
            }
            if (violations.size() > before) {
                return Optional.empty();
            }
            return Optional.of(new ActionEntry(name, title, description, risk, input, method, path));
        }

        private Set<ExtensionKind> readKinds() {
            Object raw = tree.get("kind");
            List<?> values;
            if (raw instanceof List<?> list) {
                values = list;
            } else {
                values = raw == null ? List.of() : List.of(raw);
            }
            if (values.isEmpty()) {
                violation("kind", "is required: one or more of app, extension, service, theme, locale, auth");
                return Set.of();
            }
            Set<ExtensionKind> kinds = EnumSet.noneOf(ExtensionKind.class);
            for (Object value : values) {
                ExtensionKind.fromValue(String.valueOf(value))
                        .ifPresentOrElse(kinds::add, () -> violation("kind", "unknown kind '" + value + "'"));
            }
            return kinds;
        }

        private Map<String, VersionRange> readRequires() {
            Map<String, ?> requires = optionalMap(tree, "requires");
            Map<String, VersionRange> result = new LinkedHashMap<>();
            requires.forEach((point, range) -> {
                String field = "requires." + point;
                if (!POINT_PATTERN.matcher(point).matches()) {
                    violation(field, "must be a dotted extension point or extension name");
                }
                VersionRange parsed = convert(field, String.valueOf(range), VersionRange::parse);
                if (parsed != null) {
                    result.put(point, parsed);
                }
            });
            return result;
        }

        private FrontendEntry readFrontend() {
            Map<String, ?> frontend = optionalMap(tree, "frontend");
            if (frontend.isEmpty()) {
                return null;
            }
            String entry = requiredText(frontend, "entry", "frontend.entry");
            if (entry != null && !isSafeRelativePath(entry)) {
                violation("frontend.entry", "must be a relative path inside the extension, without '..'");
            }
            String isolationText = Objects.requireNonNullElse(optionalText(frontend, "isolation"), "module");
            FrontendIsolation isolation =
                    FrontendIsolation.fromValue(isolationText).orElse(null);
            if (isolation == null) {
                violation("frontend.isolation", "must be 'module' or 'iframe'");
            }
            FrontendBridge bridge = readBridge(frontend);
            List<String> points = readPoints(frontend);
            return entry == null || isolation == null ? null : new FrontendEntry(entry, isolation, bridge, points);
        }

        private List<String> readPoints(Map<String, ?> frontend) {
            List<String> points = readList(frontend, "points", "frontend.points");
            Set<String> seen = new HashSet<>();
            for (int i = 0; i < points.size(); i++) {
                String point = points.get(i);
                String field = "frontend.points[" + i + "]";
                if (!POINT_PATTERN.matcher(point).matches()) {
                    violation(field, "must be a dotted extension point name, such as activities.detail");
                } else if (KERNEL_POINTS.stream().anyMatch(point::startsWith)) {
                    violation(field, "belongs to the kernel: use a name of the extension, such as activities.detail");
                } else if (!seen.add(point)) {
                    violation(field, "is declared twice");
                }
            }
            return points;
        }

        private FrontendBridge readBridge(Map<String, ?> frontend) {
            Map<String, ?> bridge = optionalMap(frontend, "bridge", "frontend.bridge");
            List<String> publishes = readTopics(bridge, "publishes");
            List<String> subscribes = readTopics(bridge, "subscribes");
            List<String> services = readList(bridge, "services");
            for (int i = 0; i < services.size(); i++) {
                if (!FrontendBridge.KNOWN_SERVICES.contains(services.get(i))) {
                    violation(
                            "frontend.bridge.services[" + i + "]",
                            "unknown service '" + services.get(i) + "': use one of " + FrontendBridge.KNOWN_SERVICES);
                }
            }
            return new FrontendBridge(publishes, subscribes, services);
        }

        private List<String> readTopics(Map<String, ?> bridge, String key) {
            List<String> topics = readList(bridge, key);
            for (int i = 0; i < topics.size(); i++) {
                if (!FrontendBridge.isTopic(topics.get(i))) {
                    violation(
                            "frontend.bridge." + key + "[" + i + "]",
                            "must be a dotted topic such as maps.selection.changed, or a prefix ending with .*");
                }
            }
            return topics;
        }

        private List<String> readList(Map<String, ?> map, String key) {
            return readList(map, key, "frontend.bridge." + key);
        }

        private List<String> readList(Map<String, ?> map, String key, String field) {
            Object raw = map.get(key);
            if (raw == null) {
                return List.of();
            }
            if (!(raw instanceof List<?> list)) {
                violation(field, "must be a list");
                return List.of();
            }
            return list.stream().map(String::valueOf).toList();
        }

        private BackendEntry readBackend() {
            Map<String, ?> backend = optionalMap(tree, "backend");
            if (backend.isEmpty()) {
                return null;
            }
            String jar = requiredText(backend, "jar", "backend.jar");
            if (jar != null && (!isSafeRelativePath(jar) || !jar.endsWith(".jar"))) {
                violation("backend.jar", "must be the relative path of a .jar file inside the extension, without '..'");
                jar = null;
            }
            String api = requiredText(backend, "api", "backend.api");
            if (api != null && !API_PATTERN.matcher(api).matches()) {
                violation("backend.api", "must be lowercase letters, digits and '-', for example traffic-lights");
                api = null;
            }
            return jar == null || api == null ? null : new BackendEntry(jar, api);
        }

        private DatabaseEntry readDatabase() {
            Map<String, ?> database = optionalMap(tree, "database");
            if (database.isEmpty()) {
                return null;
            }
            String schema = requiredText(database, "schema", "database.schema");
            if (schema != null && !SCHEMA_PATTERN.matcher(schema).matches()) {
                violation("database.schema", "must start with 'p_' and contain only lowercase letters, digits, '_'");
            }
            String migrations = Objects.requireNonNullElse(optionalText(database, "migrations"), "db");
            if (!isSafeRelativePath(migrations)) {
                violation("database.migrations", "must be a relative path inside the extension, without '..'");
            }
            return schema == null ? null : new DatabaseEntry(schema, migrations);
        }

        private DataEntry readData() {
            Map<String, ?> data = optionalMap(tree, "data");
            if (data.isEmpty()) {
                return null;
            }
            if (!(data.get("collections") instanceof List<?> list) || list.isEmpty()) {
                violation("data.collections", "must be a list of at least one collection name");
                return null;
            }
            List<String> collections = new ArrayList<>();
            for (int i = 0; i < list.size(); i++) {
                String field = "data.collections[" + i + "]";
                if (!(list.get(i) instanceof String name)
                        || !COLLECTION_PATTERN.matcher(name).matches()) {
                    violation(field, "must be lowercase letters, digits and '-', for example items");
                } else if (collections.contains(name)) {
                    violation(field, "the collection '" + name + "' is declared twice");
                } else {
                    collections.add(name);
                }
            }
            return new DataEntry(collections);
        }

        private ThemeEntry readTheme(java.util.Set<ExtensionKind> kinds) {
            Map<String, ?> theme = optionalMap(tree, "theme");
            if (theme.isEmpty()) {
                if (kinds.contains(ExtensionKind.THEME)) {
                    violation("theme", "an extension of kind theme must declare its theme");
                }
                return null;
            }
            String title = requiredText(theme, "title", "theme.title");
            String font = optionalText(theme, "font");
            if (font != null && !FONT_PATTERN.matcher(font).matches()) {
                violation("theme.font", "must be a font stack, such as 'Inter', sans-serif");
            }
            Integer radius = null;
            if (theme.get("radius") != null) {
                if (theme.get("radius") instanceof Integer value && value >= 0 && value <= 24) {
                    radius = value;
                } else {
                    violation("theme.radius", "must be a whole number of pixels from 0 to 24");
                }
            }
            String product = optionalText(theme, "product");
            if (product != null && !PRODUCT_PATTERN.matcher(product).matches()) {
                violation("theme.product", "must be a name of 1 to 60 letters, digits, spaces and . & ' -");
            }
            Map<String, ?> logo = optionalMap(theme, "logo", "theme.logo");
            String logoLight = logoFile(logo, "light", !logo.isEmpty());
            String logoDark = logoFile(logo, "dark", false);
            return title == null
                    ? null
                    : new ThemeEntry(
                            title,
                            font,
                            radius,
                            colors(theme, "light"),
                            colors(theme, "dark"),
                            product,
                            logoLight,
                            logoDark);
        }

        /** A logo of a theme (MK-052): an SVG or PNG file inside the extension. */
        private String logoFile(Map<String, ?> logo, String scheme, boolean required) {
            String field = "theme.logo." + scheme;
            String path = required ? requiredText(logo, scheme, field) : optionalText(logo, scheme);
            if (path != null
                    && (!isSafeRelativePath(path) || !LOGO_PATTERN.matcher(path).matches())) {
                violation(field, "must be an SVG or PNG file inside the extension, such as web/logo.svg");
                return null;
            }
            return path;
        }

        private Map<String, String> colors(Map<String, ?> theme, String scheme) {
            Map<String, ?> raw = optionalMap(theme, scheme);
            Map<String, String> colors = new java.util.LinkedHashMap<>();
            raw.forEach((name, value) -> {
                String field = "theme." + scheme + "." + name;
                if (!ThemeEntry.COLORS.contains(name)) {
                    violation(field, "is not a color of a theme: " + String.join(", ", ThemeEntry.COLORS));
                } else if (!(value instanceof String color)
                        || !COLOR_PATTERN.matcher(color).matches()) {
                    violation(field, "must be a color as #rrggbb");
                } else {
                    colors.put(name, color.toLowerCase(java.util.Locale.ROOT));
                }
            });
            return colors;
        }

        private List<Contribution> readContributions() {
            Map<String, ?> contributes = optionalMap(tree, "contributes");
            List<Contribution> result = new ArrayList<>();
            contributes.forEach((point, items) -> {
                String field = "contributes." + point;
                if (!POINT_PATTERN.matcher(point).matches()) {
                    violation(field, "must be a dotted extension point name");
                    return;
                }
                if (!(items instanceof List<?> list)) {
                    violation(field, "must be a list of contributions");
                    return;
                }
                for (int i = 0; i < list.size(); i++) {
                    readContribution(point, field + "[" + i + "]", list.get(i)).ifPresent(result::add);
                }
            });
            return result;
        }

        private Optional<Contribution> readContribution(String point, String field, Object item) {
            if (!(item instanceof Map<?, ?> raw)) {
                violation(field, MUST_BE_OBJECT);
                return Optional.empty();
            }
            Map<String, Object> attributes = new LinkedHashMap<>();
            raw.forEach((key, value) -> attributes.put(String.valueOf(key), value));
            Object id = attributes.remove("id");
            if (!(id instanceof String text) || text.isBlank()) {
                violation(field + ".id", "is required");
                return Optional.empty();
            }
            attributes.values().removeIf(Objects::isNull);
            checkTranslations(field + ".i18n", attributes.get("i18n"));
            return Optional.of(new Contribution(point, text, attributes));
        }

        /** The texts of a contribution by language (MK-053): {@code i18n: { it: { title: Catalogo } }}. */
        private void checkTranslations(String field, Object i18n) {
            if (i18n == null) {
                return;
            }
            if (!(i18n instanceof Map<?, ?> languages)) {
                violation(field, MUST_BE_OBJECT);
                return;
            }
            languages.forEach((language, texts) -> {
                String languageField = field + "." + language;
                if (!LANGUAGE_PATTERN.matcher(String.valueOf(language)).matches()) {
                    violation(languageField, "must be a language tag, such as it or pt-BR");
                } else if (!(texts instanceof Map<?, ?> values)
                        || values.values().stream().anyMatch(value -> !(value instanceof String))) {
                    violation(languageField, "must map attributes to their text, such as { title: Catalogo }");
                }
            });
        }

        private String requiredText(Map<String, ?> map, String key) {
            return requiredText(map, key, key);
        }

        private String requiredText(Map<String, ?> map, String key, String field) {
            String value = optionalText(map, key);
            if (value == null || value.isBlank()) {
                violation(field, "is required");
                return null;
            }
            return value;
        }

        private static String optionalText(Map<String, ?> map, String key) {
            Object value = map.get(key);
            return value == null ? null : String.valueOf(value).trim();
        }

        private Map<String, ?> optionalMap(Map<String, ?> map, String key) {
            return optionalMap(map, key, key);
        }

        private Map<String, ?> optionalMap(Map<String, ?> map, String key, String field) {
            Object value = map.get(key);
            if (value == null) {
                return Map.of();
            }
            if (value instanceof Map<?, ?> nested) {
                Map<String, Object> result = new LinkedHashMap<>();
                nested.forEach((k, v) -> result.put(String.valueOf(k), v));
                return result;
            }
            violation(field, MUST_BE_OBJECT);
            return Map.of();
        }

        private <T> T convert(String field, String text, Function<String, T> parser) {
            if (text == null) {
                return null;
            }
            try {
                return parser.apply(text);
            } catch (InvalidVersionException e) {
                violation(field, e.getMessage());
                return null;
            }
        }

        private void violation(String field, String message) {
            violations.add(new ManifestViolation(field, message));
        }

        private static boolean isSafeRelativePath(String path) {
            return !path.isBlank()
                    && !path.startsWith("/")
                    && !path.contains("\\")
                    && !path.contains(":")
                    && Arrays.stream(path.split("/")).noneMatch(".."::equals);
        }
    }
}
