/**
 * Slack Message Patch モーダルUI
 * Shadow DOMを使用してSlackのCSSと隔離
 */

import type { ContentSettings, ModalState, Preset } from '@/types';
import styles from './styles.css?inline';

export type ModalCallbacks = {
  onSend: (text: string) => void;
  onSendOriginal: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onPresetChange: (presetId: string) => void;
  onProofread: () => void;
};

export class SlackPatchModal {
  private container: HTMLDivElement;
  private shadowRoot: ShadowRoot;
  private state: ModalState = 'loading';
  private originalText = '';
  private proofreadText = '';
  private errorMessage = '';
  private callbacks: ModalCallbacks;
  private presets: Preset[] = [];
  private activePresetId = '';
  private beforeTextarea: HTMLTextAreaElement | null = null;
  private afterTextarea: HTMLTextAreaElement | null = null;
  private disabledInputField: HTMLElement | null = null;
  private inertElements: HTMLElement[] = [];
  private hasApiKey = false;

  // クリーンアップ用のイベントハンドラ参照
  private boundEventInterceptor: ((e: Event) => void) | null = null;
  private boundFocusOutHandler: ((e: FocusEvent) => void) | null = null;

  constructor(callbacks: ModalCallbacks) {
    this.callbacks = callbacks;

    this.container = document.createElement('div');
    this.container.id = 'slack-patch-modal-root';
    this.shadowRoot = this.container.attachShadow({
      mode: 'closed',
      delegatesFocus: true,
    });

    const styleElement = document.createElement('style');
    styleElement.textContent = styles;
    this.shadowRoot.appendChild(styleElement);
  }

  show(originalText: string, settings: ContentSettings): void {
    this.originalText = originalText;
    this.presets = settings.presets;
    this.activePresetId = settings.activePresetId;
    this.hasApiKey = settings.hasApiKey;
    this.state = 'preview';

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    // Slackの入力関連要素を完全に無効化（inert属性を使用）
    this.disableSlackInputs();
    this.setupEventInterception();

    document.body.appendChild(this.container);
    this.render();
    this.setupFocusOutPrevention();
  }

  /**
   * Slackの入力関連要素を無効化
   * inert属性を使用してフォーカス不可にする
   */
  private disableSlackInputs(): void {
    const inputField = document.querySelector('[data-message-input="true"]');
    if (inputField instanceof HTMLElement && inputField.isContentEditable) {
      inputField.contentEditable = 'false';
      this.disabledInputField = inputField;
    }

    const inputContainers = document.querySelectorAll<HTMLElement>(
      '[data-qa="message_input"], [data-qa="message-input"], .p-message_input, .c-wysiwyg_container'
    );
    for (const container of inputContainers) {
      if (!container.hasAttribute('inert')) {
        container.setAttribute('inert', '');
        this.inertElements.push(container);
      }
    }

    const editableElements = document.querySelectorAll<HTMLElement>(
      '[contenteditable="true"]:not([data-slack-patch-modal])'
    );
    for (const el of editableElements) {
      if (!el.hasAttribute('inert') && !this.shadowRoot.contains(el)) {
        el.setAttribute('inert', '');
        this.inertElements.push(el);
      }
    }
  }

  private restoreSlackInputs(): void {
    if (this.disabledInputField) {
      this.disabledInputField.contentEditable = 'true';
      this.disabledInputField = null;
    }

    for (const el of this.inertElements) {
      el.removeAttribute('inert');
    }
    this.inertElements = [];
  }

  /**
   * イベントがモーダル内から発生したかどうかを判定
   * composedPath()でShadow DOM境界を越えて正確に判定
   */
  private isEventFromModal(e: Event): boolean {
    const path = e.composedPath();
    return path.some(
      (el) => el === this.container || (el instanceof Node && this.shadowRoot.contains(el))
    );
  }

  /**
   * キーボードイベントをキャプチャフェーズで遮断
   * Slackのグローバルハンドラに到達する前にイベントを停止
   * input/beforeinputは遮断しない（テキストエリアの編集を妨げないため）
   */
  private setupEventInterception(): void {
    this.boundEventInterceptor = (e: Event) => {
      if (e.type === 'keydown') {
        this.handleKeyboardShortcut(e as KeyboardEvent);
      }

      const isFromModal = this.isEventFromModal(e);

      if (!isFromModal) {
        e.stopImmediatePropagation();
        return;
      }

      // モーダル内のキーボードイベントはSlackに到達させない
      e.stopPropagation();
    };

    const eventTypes = ['keydown', 'keyup', 'keypress'];
    for (const eventType of eventTypes) {
      document.addEventListener(eventType, this.boundEventInterceptor, true);
    }
  }

  /**
   * ショートカットキーを処理
   * キャプチャフェーズで呼ばれるため、確実にイベントを受け取れる
   */
  private handleKeyboardShortcut(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.callbacks.onCancel();
      return;
    }

    const isModifierPressed = e.metaKey || e.ctrlKey;
    const isEnter = e.key === 'Enter';

    const isTextareaFocused =
      this.shadowRoot.activeElement === this.beforeTextarea ||
      this.shadowRoot.activeElement === this.afterTextarea;

    // Enter（修飾キーなし）での送信は無効（誤送信防止）
    if (isEnter && !isModifierPressed && !e.shiftKey) {
      // テキストエリアにフォーカスがある場合は改行を許可
      if (isTextareaFocused) {
        return;
      }

      if (this.state === 'preview' || this.state === 'ready') {
        return;
      }
    }

    if (isModifierPressed && isEnter && !e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();

      if (this.state === 'preview') {
        if (this.beforeTextarea) {
          this.originalText = this.beforeTextarea.value;
        }

        if (this.hasApiKey) {
          this.callbacks.onProofread();
        } else {
          this.callbacks.onSendOriginal();
        }
      } else if (this.state === 'ready') {
        if (this.afterTextarea) {
          this.proofreadText = this.afterTextarea.value;
        }
        this.callbacks.onSend(this.proofreadText);
      }
    }
  }

  private removeEventInterception(): void {
    if (this.boundEventInterceptor) {
      const eventTypes = ['keydown', 'keyup', 'keypress'];
      for (const eventType of eventTypes) {
        document.removeEventListener(eventType, this.boundEventInterceptor, true);
      }
      this.boundEventInterceptor = null;
    }
  }

  /**
   * フォーカスアウト防止を設定
   * テキストエリアからフォーカスが外れそうになったときに防ぐ
   */
  private setupFocusOutPrevention(): void {
    this.boundFocusOutHandler = (e: FocusEvent) => {
      const relatedTarget = e.relatedTarget as Node | null;

      if (!relatedTarget || !this.shadowRoot.contains(relatedTarget)) {
        const activeTextarea = this.beforeTextarea || this.afterTextarea;
        if (activeTextarea) {
          requestAnimationFrame(() => {
            activeTextarea.focus();
          });
        }
      }
    };

    this.shadowRoot.addEventListener('focusout', this.boundFocusOutHandler as EventListener);
  }

  private removeFocusOutPrevention(): void {
    if (this.boundFocusOutHandler) {
      this.shadowRoot.removeEventListener('focusout', this.boundFocusOutHandler as EventListener);
      this.boundFocusOutHandler = null;
    }
  }

  hide(): void {
    this.removeEventInterception();
    this.removeFocusOutPrevention();

    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    this.restoreSlackInputs();
    this.beforeTextarea = null;
    this.afterTextarea = null;
  }

  setLoading(): void {
    this.state = 'loading';
    this.render();
  }

  setResult(proofreadText: string): void {
    this.proofreadText = proofreadText;
    this.state = 'ready';
    this.render();

    setTimeout(() => {
      this.afterTextarea?.focus();
    }, 100);
  }

  setError(message: string): void {
    this.errorMessage = message;
    this.state = 'error';
    this.render();
  }

  /**
   * 送信中状態を表示
   */
  setSending(): void {
    this.state = 'sending';

    const buttons = this.shadowRoot.querySelectorAll<HTMLButtonElement>('.slack-patch-btn');
    for (const btn of buttons) {
      btn.disabled = true;
    }

    const presetSelect = this.shadowRoot.querySelector<HTMLSelectElement>(
      '.slack-patch-preset-select'
    );
    if (presetSelect) {
      presetSelect.disabled = true;
    }

    if (this.beforeTextarea) {
      this.beforeTextarea.disabled = true;
    }
    if (this.afterTextarea) {
      this.afterTextarea.disabled = true;
    }

    const status = this.shadowRoot.querySelector<HTMLElement>('.slack-patch-status');
    if (status) {
      status.textContent = '送信中...';
    }
  }

  private render(): void {
    // preview状態で既にテキストエリアが存在する場合は、値だけ更新して再構築を避ける
    if (
      this.state === 'preview' &&
      this.beforeTextarea &&
      this.shadowRoot.contains(this.beforeTextarea)
    ) {
      const selectionStart = this.beforeTextarea.selectionStart;
      const selectionEnd = this.beforeTextarea.selectionEnd;
      const hadFocus = document.activeElement === this.beforeTextarea;
      this.beforeTextarea.value = this.originalText;
      this.beforeTextarea.setSelectionRange(selectionStart, selectionEnd);
      if (hadFocus && document.activeElement !== this.beforeTextarea) {
        setTimeout(() => {
          if (this.beforeTextarea) {
            this.beforeTextarea.focus();
            this.beforeTextarea.setSelectionRange(selectionStart, selectionEnd);
          }
        }, 0);
      }
      return;
    }

    const existingModal = this.shadowRoot.querySelector('.slack-patch-overlay');
    if (existingModal) {
      existingModal.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'slack-patch-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.callbacks.onCancel();
      }
    });

    const modal = document.createElement('div');
    modal.className = 'slack-patch-modal';
    modal.addEventListener('click', (e) => e.stopPropagation());

    modal.appendChild(this.createHeader());
    modal.appendChild(this.createContent());
    modal.appendChild(this.createFooter());

    overlay.appendChild(modal);
    this.shadowRoot.appendChild(overlay);

    this.setupFocusTrap(modal);
  }

  private createHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'slack-patch-header';

    const title = document.createElement('h2');
    title.className = 'slack-patch-title';
    title.textContent = 'Slack Message Patch';

    const actions = document.createElement('div');
    actions.className = 'slack-patch-header-actions';

    const presetSelect = document.createElement('select');
    presetSelect.className = 'slack-patch-preset-select';
    presetSelect.disabled = this.state === 'loading' || this.state === 'sending';

    for (const preset of this.presets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      option.selected = preset.id === this.activePresetId;
      presetSelect.appendChild(option);
    }

    presetSelect.addEventListener('change', () => {
      this.activePresetId = presetSelect.value;
      this.callbacks.onPresetChange(presetSelect.value);
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'slack-patch-close-btn';
    closeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/>
    </svg>`;
    closeBtn.addEventListener('click', () => this.callbacks.onCancel());

    if (this.hasApiKey) {
      actions.appendChild(presetSelect);
    }
    actions.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(actions);

    return header;
  }

  private createContent(): HTMLElement {
    const content = document.createElement('div');
    content.className = 'slack-patch-content';

    switch (this.state) {
      case 'preview': {
        const beforePanel = document.createElement('div');
        beforePanel.className = 'slack-patch-panel';
        beforePanel.style.gridColumn = '1 / -1';

        const beforeLabel = document.createElement('div');
        beforeLabel.className = 'slack-patch-panel-label';
        beforeLabel.textContent = '送信前';

        this.beforeTextarea = document.createElement('textarea');
        this.beforeTextarea.className = 'slack-patch-text-before-editable';
        this.beforeTextarea.setAttribute('tabindex', '0');
        this.beforeTextarea.value = this.originalText;
        this.beforeTextarea.addEventListener('input', (e) => {
          this.originalText = (e.target as HTMLTextAreaElement).value;
        });

        beforePanel.appendChild(beforeLabel);
        beforePanel.appendChild(this.beforeTextarea);
        content.appendChild(beforePanel);
        break;
      }

      case 'loading':
        content.innerHTML = `
          <div class="slack-patch-loading" style="grid-column: 1 / -1;">
            <div class="slack-patch-spinner"></div>
            <div class="slack-patch-loading-text">添削中...</div>
          </div>
        `;
        break;

      case 'error': {
        content.innerHTML = `
          <div class="slack-patch-error" style="grid-column: 1 / -1;">
            <div class="slack-patch-error-icon">!</div>
            <div class="slack-patch-error-message">${this.escapeHtml(this.errorMessage)}</div>
            <button class="slack-patch-btn slack-patch-btn-retry">リトライ</button>
          </div>
        `;
        const retryBtn = content.querySelector('.slack-patch-btn-retry');
        retryBtn?.addEventListener('click', () => this.callbacks.onRetry());
        break;
      }

      case 'ready':
      case 'sending': {
        const beforePanel = document.createElement('div');
        beforePanel.className = 'slack-patch-panel';

        const beforeLabel = document.createElement('div');
        beforeLabel.className = 'slack-patch-panel-label';
        beforeLabel.textContent = '送信前';

        const beforeText = document.createElement('div');
        beforeText.className = 'slack-patch-text-before';
        beforeText.textContent = this.originalText;

        beforePanel.appendChild(beforeLabel);
        beforePanel.appendChild(beforeText);

        const afterPanel = document.createElement('div');
        afterPanel.className = 'slack-patch-panel';

        const afterLabel = document.createElement('div');
        afterLabel.className = 'slack-patch-panel-label';
        afterLabel.textContent = '添削後';

        this.afterTextarea = document.createElement('textarea');
        this.afterTextarea.className = 'slack-patch-text-after';
        this.afterTextarea.setAttribute('tabindex', '0');
        this.afterTextarea.value = this.proofreadText;
        this.afterTextarea.disabled = this.state === 'sending';
        this.afterTextarea.addEventListener('input', (e) => {
          this.proofreadText = (e.target as HTMLTextAreaElement).value;
        });

        afterPanel.appendChild(afterLabel);
        afterPanel.appendChild(this.afterTextarea);

        content.appendChild(beforePanel);
        content.appendChild(afterPanel);
        break;
      }
    }

    return content;
  }

  private createFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'slack-patch-footer';

    const status = document.createElement('div');
    status.className = 'slack-patch-status';

    if (this.state === 'sending') {
      status.textContent = '送信中...';
    }

    footer.appendChild(status);

    if (this.state === 'preview') {
      const shortcutHint = navigator.platform.includes('Mac') ? 'Cmd+Enter' : 'Ctrl+Enter';

      if (this.hasApiKey) {
        const proofreadBtn = document.createElement('button');
        proofreadBtn.className = 'slack-patch-btn slack-patch-btn-proofread';
        proofreadBtn.innerHTML = `校正する <span class="shortcut-hint">${shortcutHint}</span>`;
        proofreadBtn.addEventListener('click', () => {
          if (this.beforeTextarea) {
            this.originalText = this.beforeTextarea.value;
          }
          this.callbacks.onProofread();
        });

        const sendOriginalBtn = document.createElement('button');
        sendOriginalBtn.className = 'slack-patch-btn slack-patch-btn-send-original';
        sendOriginalBtn.innerHTML = 'そのまま送信 <span class="shortcut-hint">Enter</span>';
        sendOriginalBtn.addEventListener('click', () => {
          if (this.beforeTextarea) {
            this.originalText = this.beforeTextarea.value;
          }
          this.callbacks.onSendOriginal();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'slack-patch-btn slack-patch-btn-cancel';
        cancelBtn.innerHTML = 'キャンセル <span class="shortcut-hint">Esc</span>';
        cancelBtn.addEventListener('click', () => this.callbacks.onCancel());

        footer.appendChild(proofreadBtn);
        footer.appendChild(sendOriginalBtn);
        footer.appendChild(cancelBtn);
      } else {
        // APIキーなし: 誤送信防止のためCmd+Enterでのみ送信
        const sendBtn = document.createElement('button');
        sendBtn.className = 'slack-patch-btn slack-patch-btn-send';
        sendBtn.innerHTML = `送信 <span class="shortcut-hint">Enter</span>`;
        sendBtn.addEventListener('click', () => {
          if (this.beforeTextarea) {
            this.originalText = this.beforeTextarea.value;
          }
          this.callbacks.onSendOriginal();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'slack-patch-btn slack-patch-btn-cancel';
        cancelBtn.innerHTML = 'キャンセル <span class="shortcut-hint">Esc</span>';
        cancelBtn.addEventListener('click', () => this.callbacks.onCancel());

        footer.appendChild(sendBtn);
        footer.appendChild(cancelBtn);
      }
    } else {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'slack-patch-btn slack-patch-btn-cancel';
      cancelBtn.innerHTML = 'キャンセル <span class="shortcut-hint">Esc</span>';
      cancelBtn.disabled = this.state === 'sending';
      cancelBtn.addEventListener('click', () => this.callbacks.onCancel());

      const sendBtn = document.createElement('button');
      sendBtn.className = 'slack-patch-btn slack-patch-btn-send';
      sendBtn.innerHTML =
        this.state === 'sending' ? '送信中...' : '送信 <span class="shortcut-hint">Enter</span>';
      sendBtn.disabled = this.state !== 'ready';
      sendBtn.addEventListener('click', () => {
        this.callbacks.onSend(this.proofreadText);
      });

      footer.appendChild(cancelBtn);
      footer.appendChild(sendBtn);
    }

    return footer;
  }

  private setupFocusTrap(modal: HTMLElement): void {
    const focusableElements = modal.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    modal.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (this.shadowRoot.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (this.shadowRoot.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    });

    setTimeout(() => {
      if (this.state === 'preview' && this.beforeTextarea) {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        this.beforeTextarea.focus();
        this.beforeTextarea.setSelectionRange(
          this.beforeTextarea.value.length,
          this.beforeTextarea.value.length
        );
      } else {
        firstElement.focus();
      }
    }, 100);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  getCurrentText(): string {
    return this.proofreadText;
  }

  getCurrentOriginalText(): string {
    return this.originalText;
  }
}
