# Transactions and the beans of the kernel

The beans of `kernel-api` (`Secrets`, `Resources`, `Sharing`, `Permissions`, `PermissionHolders`,
`FileStorage`, `Quotas`, `AuditLog`, `PlatformEvents`) join the transaction of the caller: what they
write commits or rolls back with the work of the extension.

**Documented exceptions leave your transaction usable.** An exception that a method of the API
declares in its `@throws`, such as `SecretsUnavailableException`, `NoSuchElementException`,
`IllegalArgumentException`, `AccessDeniedException` or `QuotaExceededException`, is thrown before
the bean writes anything in your transaction, and does not mark it for rollback. Catch it and go on
in the same transaction:

```java
@Transactional
public Report create(ReportRequest request) {
    String summary;
    try (SecretValue key = secrets.require("org.example.reports", "model-provider")) {
        summary = client.summarize(request.text(), key.reveal());
    } catch (SecretsUnavailableException | NoSuchElementException e) {
        summary = null; // no credential here: save the report without a summary
    }
    return reports.insert(new Report(request.title(), summary)); // commits
}
```

Any other failure of a bean, such as an error of the database, still marks the transaction for
rollback: let it go, and the kernel answers the request with an error.
