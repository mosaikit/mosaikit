// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { customElement } from 'lit/decorators.js';
import { t } from './i18n.js';
import { MkAdminSecrets } from './mk-admin-secrets.js';
import { installationSecrets, type SecretStore } from './secrets.js';

/**
 * The credentials of the installation, for platform administrators (MK-127): those of services
 * shared by every organization. The same page as the credentials of an organization, on the store
 * of the installation; a credential of an organization with the same name wins for that
 * organization.
 */
@customElement('mk-admin-installation-secrets')
export class MkAdminInstallationSecrets extends MkAdminSecrets {
  protected override secretStore(): SecretStore | undefined {
    return installationSecrets(this.client);
  }

  protected override heading(): string {
    return t('Installation credentials');
  }

  protected override introduction(): string {
    return t(
      'Keys and passwords of services shared by every organization, such as a mail relay or the account of a shared server. The extensions of every organization read them on their servers, unless the organization keeps a credential with the same name. They are encrypted, and nobody sees a value again after saving it.',
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-installation-secrets': MkAdminInstallationSecrets;
  }
}
