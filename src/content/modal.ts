/**
 * Slack Patch モーダルUI
 * Shadow DOMを使用してSlackのCSSと隔離
 */

import type { ModalState, Preset, StorageData } from '@/types';
import styles from './styles.css?inline';

export type ModalCallbacks = {
  onSend: (text: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onPresetChange: (presetId: string) => void;
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
  private afterTextarea: HTMLTextAreaElement | null = null;

  constructor(callbacks: ModalCallbacks) {
    this.callbacks = callbacks;

    // Shadow DOM用のコンテナを作成
    this.container = document.createElement('div');
    this.container.id = 'slack-patch-modal-root';
    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

    // スタイルを注入
    const styleElement = document.createElement('style');
    styleElement.textContent = styles;
    this.shadowRoot.appendChild(styleElement);
  }

  /**
   * モーダルを表示
   */
  show(originalText: string, settings: StorageData): void {
    this.originalText = originalText;
    this.presets = settings.presets;
    this.activePresetId = settings.activePresetId;
    this.state = 'loading';

    document.body.appendChild(this.container);
    this.render();

    // Escキーでクローズ
    document.addEventListener('keydown', this.handleKeyDown);
  }

  /**
   * モーダルを非表示
   */
  hide(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }

  /**
   * ローディング状態を表示
   */
  setLoading(): void {
    this.state = 'loading';
    this.render();
  }

  /**
   * 添削結果を表示
   */
  setResult(proofreadText: string): void {
    this.proofreadText = proofreadText;
    this.state = 'ready';
    this.render();

    // テキストエリアにフォーカス
    setTimeout(() => {
      this.afterTextarea?.focus();
    }, 100);
  }

  /**
   * エラー状態を表示
   */
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
    this.render();
  }

  /**
   * キーボードイベントハンドラ
   */
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.callbacks.onCancel();
    }
  };

  /**
   * モーダルをレンダリング
   */
  private render(): void {
    // 既存のコンテンツをクリア（スタイル以外）
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

    // ヘッダー
    modal.appendChild(this.createHeader());

    // コンテンツ
    modal.appendChild(this.createContent());

    // フッター
    modal.appendChild(this.createFooter());

    overlay.appendChild(modal);
    this.shadowRoot.appendChild(overlay);

    // フォーカストラップ設定
    this.setupFocusTrap(modal);
  }

  /**
   * ヘッダーを作成
   */
  private createHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'slack-patch-header';

    const title = document.createElement('h2');
    title.className = 'slack-patch-title';
    title.textContent = 'Slack Patch';

    const actions = document.createElement('div');
    actions.className = 'slack-patch-header-actions';

    // プリセット選択
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

    // 閉じるボタン
    const closeBtn = document.createElement('button');
    closeBtn.className = 'slack-patch-close-btn';
    closeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/>
    </svg>`;
    closeBtn.addEventListener('click', () => this.callbacks.onCancel());

    actions.appendChild(presetSelect);
    actions.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(actions);

    return header;
  }

  /**
   * コンテンツを作成
   */
  private createContent(): HTMLElement {
    const content = document.createElement('div');
    content.className = 'slack-patch-content';

    switch (this.state) {
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
        // Before パネル
        const beforePanel = document.createElement('div');
        beforePanel.className = 'slack-patch-panel';

        const beforeLabel = document.createElement('div');
        beforeLabel.className = 'slack-patch-panel-label';
        beforeLabel.textContent = '送信前 (Before)';

        const beforeText = document.createElement('div');
        beforeText.className = 'slack-patch-text-before';
        beforeText.textContent = this.originalText;

        beforePanel.appendChild(beforeLabel);
        beforePanel.appendChild(beforeText);

        // After パネル
        const afterPanel = document.createElement('div');
        afterPanel.className = 'slack-patch-panel';

        const afterLabel = document.createElement('div');
        afterLabel.className = 'slack-patch-panel-label';
        afterLabel.textContent = '添削後 (After)';

        this.afterTextarea = document.createElement('textarea');
        this.afterTextarea.className = 'slack-patch-text-after';
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

  /**
   * フッターを作成
   */
  private createFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'slack-patch-footer';

    // ステータス
    const status = document.createElement('div');
    status.className = 'slack-patch-status';

    if (this.state === 'sending') {
      status.textContent = '送信中...';
    }

    footer.appendChild(status);

    // Copy ボタン
    const copyBtn = document.createElement('button');
    copyBtn.className = 'slack-patch-btn slack-patch-btn-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.disabled = this.state !== 'ready';
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(this.proofreadText);
      status.textContent = 'コピーしました';
      status.classList.add('success');
      setTimeout(() => {
        status.textContent = '';
        status.classList.remove('success');
      }, 2000);
    });

    // Cancel ボタン
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'slack-patch-btn slack-patch-btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.disabled = this.state === 'sending';
    cancelBtn.addEventListener('click', () => this.callbacks.onCancel());

    // Send ボタン
    const sendBtn = document.createElement('button');
    sendBtn.className = 'slack-patch-btn slack-patch-btn-send';
    sendBtn.textContent = this.state === 'sending' ? '送信中...' : 'Send';
    sendBtn.disabled = this.state !== 'ready';
    sendBtn.addEventListener('click', () => {
      this.callbacks.onSend(this.proofreadText);
    });

    footer.appendChild(copyBtn);
    footer.appendChild(cancelBtn);
    footer.appendChild(sendBtn);

    return footer;
  }

  /**
   * フォーカストラップを設定
   */
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

    // 初期フォーカス
    setTimeout(() => firstElement.focus(), 0);
  }

  /**
   * HTMLエスケープ
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 現在の添削後テキストを取得
   */
  getCurrentText(): string {
    return this.proofreadText;
  }
}
