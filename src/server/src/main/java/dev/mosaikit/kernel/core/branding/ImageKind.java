// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.branding;

import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import java.util.Arrays;

/** The images of the branding of an organization (MK-074). */
public enum ImageKind {
    /** The logo for light backgrounds: the sign-in page, in the light scheme. */
    LOGO("logo"),
    /** The logo for dark backgrounds: the bar of the shell, and the sign-in page in the dark scheme. */
    LOGO_DARK("logo-dark"),
    /** A square mark, for the bar of the shell when there is no logo for dark backgrounds. */
    ICON("icon"),
    /** The icon of the page in the tabs of the browser. */
    FAVICON("favicon");

    private final String id;

    ImageKind(String id) {
        this.id = id;
    }

    /** The name in the API and in the database. */
    public String id() {
        return id;
    }

    /**
     * The kind named in an address.
     *
     * @throws ResourceNotFoundException when no image has that name
     */
    public static ImageKind of(String id) {
        return Arrays.stream(values())
                .filter(kind -> kind.id.equals(id))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException(
                        "No image " + id + ": logo, logo-dark, icon or favicon."));
    }
}
