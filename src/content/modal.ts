/**
 * Slack Message Patch モーダルUI
 * Shadow DOMを使用してSlackのCSSと隔離
 */

import type { ModalState, Preset, StorageData } from '@/types';
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

  // イベントハンドラへの参照（クリーンアップ用）
  private boundEventInterceptor: ((e: Event) => void) | null = null;
  private boundFocusOutHandler: ((e: FocusEvent) => void) | null = null;

  constructor(callbacks: ModalCallbacks) {
    this.callbacks = callbacks;

    // Shadow DOM用のコンテナを作成
    this.container = document.createElement('div');
    this.container.id = 'slack-patch-modal-root';
    this.shadowRoot = this.container.attachShadow({ mode: 'closed', delegatesFocus: true });

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
    this.hasApiKey = !!settings.apiKey;
    this.state = 'preview';

    // Slackの入力フィールドからフォーカスを外す
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    // Slackの入力関連要素を完全に無効化（inert属性を使用）
    this.disableSlackInputs();

    // キーボードイベントをキャプチャフェーズで遮断
    this.setupEventInterception();

    document.body.appendChild(this.container);
    this.render();

    // フォーカスアウト防止を設定
    this.setupFocusOutPrevention();
  }

  /**
   * Slackの入力関連要素を無効化
   * inert属性を使用してフォーカス不可にする
   */
  private disableSlackInputs(): void {
    // Slackの入力フィールドを一時的に無効化
    const inputField = document.querySelector('[data-message-input="true"]');
    if (inputField instanceof HTMLElement && inputField.isContentEditable) {
      inputField.contentEditable = 'false';
      this.disabledInputField = inputField;
    }

    // メッセージ入力コンテナにinert属性を追加
    const inputContainers = document.querySelectorAll<HTMLElement>(
      '[data-qa="message_input"], [data-qa="message-input"], .p-message_input, .c-wysiwyg_container'
    );
    for (const container of inputContainers) {
      if (!container.hasAttribute('inert')) {
        container.setAttribute('inert', '');
        this.inertElements.push(container);
      }
    }

    // contenteditable要素もinertに
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

  /**
   * Slackの入力関連要素を復元
   */
  private restoreSlackInputs(): void {
    // contentEditable復元
    if (this.disabledInputField) {
      this.disabledInputField.contentEditable = 'true';
      this.disabledInputField = null;
    }

    // inert属性を削除
    for (const el of this.inertElements) {
      el.removeAttribute('inert');
    }
    this.inertElements = [];
  }

  /**
   * イベントがモーダル内から発生したかどうかを判定
   * Shadow DOMの境界を越えてもcomposedPath()で正確に判定
   */
  private isEventFromModal(e: Event): boolean {
    // composedPath()はShadow DOM境界を越えてイベントパスを取得できる
    const path = e.composedPath();
    return path.some(
      (el) => el === this.container || (el instanceof Node && this.shadowRoot.contains(el))
    );
  }

  /**
   * キーボードイベントをキャプチャフェーズで遮断
   * Slackのグローバルハンドラに到達する前にイベントを停止
   * 注: input/beforeinputは遮断しない（テキストエリアの編集を妨げないため）
   */
  private setupEventInterception(): void {
    this.boundEventInterceptor = (e: Event) => {
      // keydownイベントの場合はショートカットキーを処理
      if (e.type === 'keydown') {
        this.handleKeyboardShortcut(e as KeyboardEvent);
      }

      // モーダル内からのイベントかチェック
      const isFromModal = this.isEventFromModal(e);

      // モーダル外からのイベントは遮断
      if (!isFromModal) {
        e.stopImmediatePropagation();
        return;
      }

      // モーダル内のキーボードイベントはSlackに到達させない
      e.stopPropagation();
    };

    // キャプチャフェーズでキーボードイベントのみを登録
    // input/beforeinputは遮断しない（テキストエリアの編集に必要）
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
    // Escapeキーでモーダルを閉じる
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.callbacks.onCancel();
      return;
    }

    const isModifierPressed = e.metaKey || e.ctrlKey;
    const isEnter = e.key === 'Enter';

    // Enter（修飾キーなし）での送信
    if (isEnter && !isModifierPressed && !e.shiftKey) {
      if (this.state === 'preview') {
        // preview状態: そのまま送信
        e.preventDefault();
        e.stopImmediatePropagation();

        if (this.beforeTextarea) {
          this.originalText = this.beforeTextarea.value;
        }
        this.callbacks.onSendOriginal();
        return;
      }
      if (this.state === 'ready') {
        // ready状態: 添削後のテキストを送信
        e.preventDefault();
        e.stopImmediatePropagation();

        if (this.afterTextarea) {
          this.proofreadText = this.afterTextarea.value;
        }
        this.callbacks.onSend(this.proofreadText);
        return;
      }
    }

    // Cmd+Enter または Ctrl+Enter の検出
    if (isModifierPressed && isEnter && !e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();

      if (this.state === 'preview') {
        // テキストエリアから最新のテキストを取得
        if (this.beforeTextarea) {
          this.originalText = this.beforeTextarea.value;
        }

        if (this.hasApiKey) {
          // APIキーあり: 校正開始
          this.callbacks.onProofread();
        } else {
          // APIキーなし: 直接送信
          this.callbacks.onSendOriginal();
        }
      } else if (this.state === 'ready') {
        // ready状態: 添削後のテキストを送信
        if (this.afterTextarea) {
          this.proofreadText = this.afterTextarea.value;
        }
        this.callbacks.onSend(this.proofreadText);
      }
    }
  }

  /**
   * イベント遮断を解除
   */
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

      // フォーカス先がモーダル外の場合
      if (!relatedTarget || !this.shadowRoot.contains(relatedTarget)) {
        // 現在フォーカスしているテキストエリアにフォーカスを戻す
        const activeTextarea = this.beforeTextarea || this.afterTextarea;
        if (activeTextarea) {
          requestAnimationFrame(() => {
            activeTextarea.focus();
          });
        }
      }
    };

    // Shadow DOM内のfocusoutを監視
    this.shadowRoot.addEventListener('focusout', this.boundFocusOutHandler as EventListener);
  }

  /**
   * フォーカスアウト防止を解除
   */
  private removeFocusOutPrevention(): void {
    if (this.boundFocusOutHandler) {
      this.shadowRoot.removeEventListener('focusout', this.boundFocusOutHandler as EventListener);
      this.boundFocusOutHandler = null;
    }
  }

  /**
   * モーダルを非表示
   */
  hide(): void {
    // イベントリスナーをクリーンアップ
    this.removeEventInterception();
    this.removeFocusOutPrevention();

    // DOMからモーダルを削除
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    // Slackの入力フィールドを復元
    this.restoreSlackInputs();

    // テキストエリアへの参照をクリア
    this.beforeTextarea = null;
    this.afterTextarea = null;
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
   * モーダルをレンダリング
   */
  private render(): void {
    // preview状態で既にテキストエリアが存在する場合は、値だけ更新して再構築を避ける
    if (
      this.state === 'preview' &&
      this.beforeTextarea &&
      this.shadowRoot.contains(this.beforeTextarea)
    ) {
      // テキストエリアの値を更新（フォーカスを維持）
      const selectionStart = this.beforeTextarea.selectionStart;
      const selectionEnd = this.beforeTextarea.selectionEnd;
      const hadFocus = document.activeElement === this.beforeTextarea;
      this.beforeTextarea.value = this.originalText;
      // カーソル位置を復元
      this.beforeTextarea.setSelectionRange(selectionStart, selectionEnd);
      // フォーカスが外れていた場合は再度フォーカスを設定
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
    title.textContent = 'Slack Message Patch';

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

    // APIキーがある場合のみプリセット選択を表示
    if (this.hasApiKey) {
      actions.appendChild(presetSelect);
    }
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
      case 'preview': {
        // Before パネルのみ表示（編集可能）
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
          // テキストを更新するだけで、render()は呼ばない
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
        // Before パネル
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

        // After パネル
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

    if (this.state === 'preview') {
      const shortcutHint = navigator.platform.includes('Mac') ? 'Cmd+Enter' : 'Ctrl+Enter';

      if (this.hasApiKey) {
        // APIキーあり: 校正するボタン、そのまま送信ボタン、キャンセルボタン
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
        // APIキーなし: 送信ボタン、キャンセルボタンのみ（シンプルモード）
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
      // ready/loading/error/sending状態: 既存のボタン
      // コピーボタン
      const copyBtn = document.createElement('button');
      copyBtn.className = 'slack-patch-btn slack-patch-btn-copy';
      copyBtn.textContent = 'コピー';
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

      // キャンセルボタン
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'slack-patch-btn slack-patch-btn-cancel';
      cancelBtn.innerHTML = 'キャンセル <span class="shortcut-hint">Esc</span>';
      cancelBtn.disabled = this.state === 'sending';
      cancelBtn.addEventListener('click', () => this.callbacks.onCancel());

      // 送信ボタン
      const sendBtn = document.createElement('button');
      sendBtn.className = 'slack-patch-btn slack-patch-btn-send';
      sendBtn.innerHTML =
        this.state === 'sending' ? '送信中...' : '送信 <span class="shortcut-hint">Enter</span>';
      sendBtn.disabled = this.state !== 'ready';
      sendBtn.addEventListener('click', () => {
        this.callbacks.onSend(this.proofreadText);
      });

      footer.appendChild(copyBtn);
      footer.appendChild(cancelBtn);
      footer.appendChild(sendBtn);
    }

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
    setTimeout(() => {
      // preview状態の場合はテキストエリアにフォーカス
      if (this.state === 'preview' && this.beforeTextarea) {
        // Slackの入力フィールドからフォーカスを外す
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        this.beforeTextarea.focus();
        // カーソルを末尾に移動
        this.beforeTextarea.setSelectionRange(
          this.beforeTextarea.value.length,
          this.beforeTextarea.value.length
        );
      } else {
        firstElement.focus();
      }
    }, 100);
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

  /**
   * 現在の元テキストを取得（編集可能）
   */
  getCurrentOriginalText(): string {
    return this.originalText;
  }
}
