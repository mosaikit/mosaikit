// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * Defines the Fluent UI web components (`fluent-*` elements) once for the page. The shell imports
 * this module; extensions use the elements it defines and style themselves with the `--mk-*` tokens.
 */
import '@fluentui/web-components/accordion/define.js';
import '@fluentui/web-components/accordion-item/define.js';
import '@fluentui/web-components/anchor-button/define.js';
import '@fluentui/web-components/avatar/define.js';
import '@fluentui/web-components/badge/define.js';
import '@fluentui/web-components/button/define.js';
import '@fluentui/web-components/checkbox/define.js';
import '@fluentui/web-components/compound-button/define.js';
import '@fluentui/web-components/counter-badge/define.js';
import '@fluentui/web-components/dialog/define.js';
import '@fluentui/web-components/dialog-body/define.js';
import '@fluentui/web-components/divider/define.js';
import '@fluentui/web-components/drawer/define.js';
import '@fluentui/web-components/drawer-body/define.js';
import '@fluentui/web-components/dropdown/define.js';
import '@fluentui/web-components/field/define.js';
import '@fluentui/web-components/image/define.js';
import '@fluentui/web-components/label/define.js';
import '@fluentui/web-components/link/define.js';
import '@fluentui/web-components/listbox/define.js';
import '@fluentui/web-components/menu/define.js';
import '@fluentui/web-components/menu-button/define.js';
import '@fluentui/web-components/menu-item/define.js';
import '@fluentui/web-components/menu-list/define.js';
import '@fluentui/web-components/message-bar/define.js';
import '@fluentui/web-components/option/define.js';
import '@fluentui/web-components/progress-bar/define.js';
import '@fluentui/web-components/radio/define.js';
import '@fluentui/web-components/radio-group/define.js';
import '@fluentui/web-components/rating-display/define.js';
import '@fluentui/web-components/slider/define.js';
import '@fluentui/web-components/spinner/define.js';
import '@fluentui/web-components/switch/define.js';
import '@fluentui/web-components/tab/define.js';
import '@fluentui/web-components/tablist/define.js';
import '@fluentui/web-components/text/define.js';
import '@fluentui/web-components/text-input/define.js';
import '@fluentui/web-components/textarea/define.js';
import '@fluentui/web-components/toggle-button/define.js';
import '@fluentui/web-components/tooltip/define.js';
import '@fluentui/web-components/tree/define.js';
import '@fluentui/web-components/tree-item/define.js';
// The page patterns of the UI kit (MK-105): list page, empty and error states, resizable pane.
import './empty-state.js';
import './list-page.js';
import './split-pane.js';
