# Palette (React sample)

A plugin frontend written with React (MK-021). `npm run build` (run by the Maven build through the
npm workspaces) bundles it with Vite into one ES module, `dist/index.js`, with React inside: the
framework is private to the plugin, and the shell imports the module like any other frontend.

It picks a colour, publishes `palette.selected` on the bus and shows the previews that other
plugins contribute to its `palette.preview` point, such as the [Vue sample](../sample-vue).
