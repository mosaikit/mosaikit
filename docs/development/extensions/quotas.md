# Quotas

Declare in `measures` of the manifest what the extension consumes for each organization, such as
calls to a paid service or the credits of a model (MK-076). A **counter** counts what is used in a
calendar month (UTC) and starts from zero every month; a **gauge** is what the organization keeps
now. In the kernel a measure is `<extension>/<id>`, such as `dev.example.hello/greetings`. Platform
administrators set its limit for an organization (or a default for every organization, with
`mosaikit.quotas.limits."dev.example.hello/greetings"`), and the administrators of the organization
see what it used, by month and person, on their Quotas page. Without a limit everything fits, so an
extension counts its consumption whether or not there is one.

Inject the `Quotas` bean (`dev.mosaikit.kernel.api.quota`) and name the extension in every call, as
with `Resources`:

```java
@Inject Quotas quotas;

public Map render(Request request) {
    long tiles = request.tiles();
    // Counted for the person of the request; refused, counting nothing, when it does not fit.
    quotas.consume("dev.example.maps", "renders", tiles);
    return renderer.render(request);
}
```

- `check(extension, measure, amount)` only reads: whether the amount fits, the `limit`, what is
  `used` and what `remaining()`. Use it to refuse early or to show what is left; `storage` is
  accepted too, to know whether data of a given size would fit.
- `consume(extension, measure, amount)` counts an amount of a counter for the person of the request,
  or for none in a job.
- `set(extension, measure, amount)` sets what the organization keeps now of a gauge.
- `reportSpace(resource, bytes)` sets the space that the extension keeps for one of its registered
  resources (MK-054) outside the files of the kernel: tables, tiles, indexes. It counts to the
  **storage** of the organization with its files, and to the owner of the resource, and goes when the
  resource is removed from the registry. Files stored through the file service of the kernel are
  counted already: do not report them.

`consume`, `set` and `reportSpace` check and count in one step, under a lock of the quota until the
transaction ends: two requests at the same time cannot both pass a limit that only one fits. More
than allowed throws `QuotaExceededException` and changes nothing; let it go out of the REST resource
and the kernel answers `403 Quota exceeded`, a problem detail whose `detail` and member `quota`
(`measure`, `unit`, `period`, `limit`, `used`, `requested`) name the limit. Less space, or a gauge
that goes down, always passes. A measure that the manifest does not declare, or an extension that is
not active, is refused with `IllegalArgumentException`.
