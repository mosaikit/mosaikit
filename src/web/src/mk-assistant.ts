// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ChatMessage, KernelClient } from './api.js';

/**
 * The assistant panel of the home page (MK-024): the person writes, the assistant answers with the
 * tools of the plugins. Changes come back as drafts, which the shell lists under Pending actions;
 * the panel fires `mk-drafts-changed` when there are new ones.
 */
@customElement('mk-assistant')
export class MkAssistant extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      padding: 12px 16px;
      margin-bottom: 16px;
      max-width: 720px;
    }
    ol {
      list-style: none;
      padding: 0;
      margin: 0 0 12px;
      display: grid;
      gap: 8px;
    }
    li.user {
      justify-self: end;
      background: var(--mk-surface);
    }
    li {
      padding: 8px 12px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-line);
      white-space: pre-wrap;
    }
    form {
      display: flex;
      gap: 8px;
    }
    textarea {
      flex: 1;
      font: inherit;
      padding: 8px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-bg);
      color: var(--mk-fg);
    }
    button {
      font: inherit;
      font-weight: 600;
      padding: 8px 12px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-accent);
      background: var(--mk-accent);
      color: var(--mk-accent-fg);
      cursor: pointer;
    }
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    .error {
      color: var(--mk-danger);
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;
  @property() model: string | undefined;

  @state() private messages: ChatMessage[] = [];
  @state() private busy = false;
  @state() private error: string | undefined;

  override render(): unknown {
    return html`
      <h2>Assistant</h2>
      <p class="muted">
        It uses the apps with your
        permissions${this.model ? html` (model ${this.model})` : nothing}. Changes wait for your
        confirmation under Pending actions.
      </p>
      <ol aria-live="polite">
        ${this.messages.map((message) => html`<li class=${message.role}>${message.content}</li>`)}
      </ol>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      <form @submit=${this.send}>
        <textarea
          name="question"
          rows="2"
          maxlength="8000"
          required
          aria-label="Question for the assistant"
          placeholder="Ask something about your apps"
          ?disabled=${this.busy}
        ></textarea>
        <button type="submit" ?disabled=${this.busy}>${this.busy ? 'Thinking…' : 'Ask'}</button>
      </form>
    `;
  }

  private readonly send = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const field = form.elements.namedItem('question') as HTMLTextAreaElement;
    const question = field.value.trim();
    if (!question || !this.client) {
      return;
    }
    const asked: ChatMessage = { role: 'user', content: question };
    const conversation: ChatMessage[] = [...this.messages, asked].slice(-20);
    this.messages = conversation;
    field.value = '';
    this.busy = true;
    this.error = undefined;
    try {
      const reply = await this.client.ask(conversation);
      const answered: ChatMessage = { role: 'assistant', content: reply.reply };
      this.messages = [...conversation, answered];
      if (reply.drafts.length > 0) {
        this.dispatchEvent(new CustomEvent('mk-drafts-changed', { bubbles: true, composed: true }));
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The assistant cannot answer now.';
    } finally {
      this.busy = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-assistant': MkAssistant;
  }
}
