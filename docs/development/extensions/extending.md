# Extending another extension

An extension extends another one on three levels ([ADR-0019](../../adr/0019-plugins-extending-plugins.md)),
as [`sample-estimates`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/estimates) extends
[`sample-activities`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/activities):

1. **Require it**, so that the kernel migrates it first and refuses yours without it:
   `requires: { dev.mosaikit.sample.activities: '^0.1' }`.
2. **Data**: keep your field in a table of your schema keyed by its identifiers, without a foreign
   key, and read its data only through the views it publishes (`ext_sample_activities.activity_v1`),
   mapped as read-only entities. Publish your own views `with (security_invoker = true)`, so that
   row-level security applies to whoever reads them.
3. **Interface**: contribute a custom element to one of the points its frontend declares:

   ```yaml
   contributes:
     activities.detail:
       - id: estimate
         element: mk-activity-estimate   # receives the activity in its activity-id attribute
   ```

   The owner of a point reads the contributions with `context.contributionsTo('activities.detail')`
   and creates the elements; a point can type and version its contributions
   ([Contracts between extensions](contracts.md#contracts-between-extensions)). The contributions of an extension turned off for the organization are
   missing, so the owner shows them as unavailable instead of breaking.

   The app Teams declares `channel.tab`, the tabs of its channels (MK-035): contribute
   `{ id, title, element }`, and the element gets the properties `team` and `channel`, the
   identifiers of the team and of the channel, to read and write the documents of that team:

   ```yaml
   contributes:
     channel.tab:
       - id: todo
         title: To do
         element: mk-sample-todo
   ```
4. **Behaviour**: publish and subscribe to events on the bus (`estimates.changed`,
   `activities.completed`).
