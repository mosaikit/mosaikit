# Green theme (fixture)

A theme extension ([MK-028](../../../../docs/requirements/MK-028.yaml)): a manifest of kind `theme` with the
colors of a brand for the light and dark schemes. Installed from the Extensions page
it is active at once: people choose **Green** in their settings, or the installation makes it the
default with `mosaikit.ui.theme=dev.mosaikit.fixture.theme`.

As the theme of the installation it also renames the product **Green Works** and brings its logo
([MK-052](../../../../docs/requirements/MK-052.yaml)): the shell shows them in its bar, on the
sign-in page, in the title of the page and as its icon.

The colors it leaves out (background, surface, text, lines, states) come from the default theme, so
a theme can set only the brand color. The shell refuses colors that are not `#rrggbb`.
