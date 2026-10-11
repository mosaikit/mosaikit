# Estimates (sample extension plugin)

Extends the [Activities](../sample-activities/README.md) app on the three levels of MK-020,
without a foreign key between the two schemas and without changing Activities:

| Level | How |
|---|---|
| Data | the table `estimate` of its own schema, keyed by the activity identifier; the activities come from the view `p_sample_activities.activity_v1`, the data contract of Activities |
| Interface | the widget `mk-activity-estimate`, contributed to the `activities.detail` point |
| Behaviour | the event `estimates.changed`, which Activities uses for its total, and `activities.completed`, which locks the widget |

It declares `requires: dev.mosaikit.sample.activities`, so the kernel migrates Activities first
and refuses Estimates when Activities is missing.
