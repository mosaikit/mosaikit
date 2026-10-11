# Green theme (sample)

A theme plugin ([MK-028](../../../docs/requirements/MK-028.yaml)): a manifest of kind `theme` with the
colors of a brand for the light and dark schemes, and nothing else. Installed from the Plugins page
it is active at once: people choose **Green** in their settings, or the installation makes it the
default with `mosaikit.ui.theme=dev.mosaikit.sample.theme`.

The colors it leaves out (background, surface, text, lines, states) come from the default theme, so
a theme can set only the brand color. The shell refuses colors that are not `#rrggbb`.
