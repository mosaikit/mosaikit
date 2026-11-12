#!/usr/bin/env python3
"""Counts the automated tests of Mosaikit and the security ones (the figures shown on the site).

    python tests/count-tests.py            # Rust tests of the platform, security subset, documented checks, load test
    python tests/count-tests.py --names    # also lists the security tests it counted

The Rust tests are the ones `cargo nextest list --workspace` finds (the run on PostgreSQL: the same tests run again on SQLite).
The interface tests (vitest), the plugin tests and the browser tests are counted by the report of the latest run
(`tests/results/test-results.md`, written by `cargo xtask ci` and `cargo xtask e2e`); the total on the site is their sum.

**Security tests** are the tests of the areas that protect the platform, chosen by rule so the figure can be checked:
every test of the binaries in WHOLE (SQL guard, row-level security, run tickets, public commands, embeds, host operations, OIDC,
identity and tenancy), and the tests of the other binaries whose name says one of the KEY words, except the ones in DENY
(names that match a word but test something else). The list is printed with `--names`.
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WHOLE = ['mosaikit-sql-guard', 'mosaikit-db::rls', 'mosaikit-kernel::run_tickets', 'mosaikit-kernel::public_commands',
         'mosaikit-kernel::public_embeds', 'mosaikit-kernel::embeds', 'mosaikit-kernel::host_ops', 'mosaikit-kernel::oidc_groups',
         'mosaikit-kernel::identity_tenancy', 'mosaikit-server::oidc']
KEY = re.compile(r'secret|csrf|cookie|session|origin|untrusted|sandbox|malicious|forbid|permission|denied|refus|rls|acl|polic|signature|signed|tamper|password|totp|second_factor|token|public|escape|inject|csp|sanitiz|ssrf|rate_limit|locked|lockout|revoke|blocklist|cannot|never|admin_only|isolat|guard|leak|read_only|ticket|credential|memory_beyond|non_conforming|hostile', re.I)
DENY = re.compile(r'cron::|navgroups|product::|config::tests|levels::|sidecar|deprecated|social_preview|byte_ranges|deploy_check|dist::tests|keycloak|dev::tests|model::tests|recipes_plugin|plugin_lists|sorting|schedule_worker|an_empty_file|database_tests|docker_release|the_configuration|credentials_name|keygen_never|explicit_key|initial_password|lifecycle_ops plugin|plugins_tenants extension|tenants_sort|settings_keys|tenancy|never_fires|refuses_what|the_limiter_forgets|a_seed_never|a_deployment_seeds|refused_migration|validation_and_refusing|log_filters|info_of_a_folder|forgot_password|search|one_origin_per_plugin|embedders_join|embedded_pages_open|unknown_key|a_table_or_key', re.I)


def main():
    out = subprocess.run(['cargo', 'nextest', 'list', '--workspace', '--message-format', 'json'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    suites = json.loads(out)['rust-suites']
    total = whole = 0
    named = []
    for bid, suite in suites.items():
        for name, t in suite['testcases'].items():
            if t.get('ignored'):
                continue
            total += 1
            full = f'{bid} {name}'
            if bid in WHOLE:
                whole += 1
            elif KEY.search(name) and not DENY.search(full):
                named.append(full)
    print(f'Rust tests of the platform: {total}')
    print(f'security tests among them: {whole + len(named)} ({whole} in whole binaries, {len(named)} by name)')
    ids = set()
    for line in open(os.path.join(ROOT, 'docs', 'manual-tests.md'), encoding='utf-8'):
        m = re.match(r'\|\s*([A-Z][A-Z0-9]*-\d+[a-z]?)\s*\|', line)
        if m:
            ids.add(m.group(1))
    print(f'documented checks (docs/manual-tests.md): {len(ids)}')
    perf = open(os.path.join(ROOT, 'docs', 'reports', 'performance.md'), encoding='utf-8').read()
    table = perf.split('## SQLite')[0].split('## PostgreSQL: before and after')[1]
    rows = [l for l in table.split('\n') if l.startswith('|') and not l.startswith('|---') and 'p50' not in l]
    print(f'operations measured by the load test on PostgreSQL: {len(rows)}')
    if '--names' in sys.argv:
        print('\nsecurity tests found by name:')
        print('\n'.join('  ' + n for n in named))


if __name__ == '__main__':
    main()
