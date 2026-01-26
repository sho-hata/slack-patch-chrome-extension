/**
 * Slack Message Patch Content Script
 * Slackページに注入され、ショートカット検出とモーダル制御を行う
 */

import type {
  GetSettingsRequest,
  ProofreadRequest,
  ProofreadResponse,
  SettingsResponse,
  StorageData,
} from '@/types';
import { type ModalCallbacks, SlackPatchModal } from './modal';
import { findActiveInputField, getInputText, setInputText, triggerSend } from './slack-dom';

// 現在のモーダルインスタンス
let currentModal: SlackPatchModal | null = null;

// 現在の入力欄（送信用に保持）
let currentInputField: HTMLElement | null = null;

// 設定のキャッシュ
let cachedSettings: StorageData | null = null;

// 初期化済みフラグ
let initialized = false;

/**
 * 拡張機能のコンテキストが有効かチェック
 */
const isExtensionContextValid = (): boolean => {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
};

/**
 * 初期化
 */
const initialize = (): void => {
  if (initialized) return;
  initialized = true;

  console.log('[Slack Message Patch] Initialized');

  // キーボードショートカットのリスナーを登録
  document.addEventListener('keydown', handleKeyDown, true);

  // 設定を事前読み込み
  loadSettings();
};

/**
 * 設定を読み込む
 */
const loadSettings = async (): Promise<StorageData> => {
  return new Promise((resolve, reject) => {
    if (!isExtensionContextValid()) {
      reject(new Error('Extension context invalidated'));
      return;
    }

    const message: GetSettingsRequest = { type: 'GET_SETTINGS' };
    try {
      chrome.runtime.sendMessage(message, (response: SettingsResponse) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        cachedSettings = response.settings;
        resolve(response.settings);
      });
    } catch {
      reject(new Error('Failed to send message'));
    }
  });
};

/**
 * ショートカットキーが一致するかチェック
 */
const isShortcutMatch = (event: KeyboardEvent): boolean => {
  if (!cachedSettings?.shortcut) {
    // デフォルト: Cmd/Ctrl + Enter
    return (event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.shiftKey;
  }

  const shortcut = cachedSettings.shortcut;

  // キーが一致するか
  if (event.key !== shortcut.key) return false;

  // Ctrl/Cmdは OR 条件（どちらかが設定されていればどちらでも可）
  const ctrlOrMeta = shortcut.ctrlKey || shortcut.metaKey;
  if (ctrlOrMeta) {
    if (!event.ctrlKey && !event.metaKey) return false;
  } else {
    // どちらも設定されていない場合は、どちらも押されていないことを確認
    if (event.ctrlKey || event.metaKey) return false;
  }

  // Alt キー
  if (shortcut.altKey !== event.altKey) return false;

  // Shift キー
  if (shortcut.shiftKey !== event.shiftKey) return false;

  return true;
};

/**
 * キーダウンイベントハンドラ
 */
const handleKeyDown = (event: KeyboardEvent): void => {
  // IME変換中は無視
  if (event.isComposing) return;

  // ショートカットキーの検出
  if (isShortcutMatch(event)) {
    // モーダルが既に開いている場合は無視
    if (currentModal) return;

    // アクティブな入力欄を取得
    const inputField = findActiveInputField();
    if (!inputField) return;

    // テキストを取得
    const text = getInputText(inputField);
    if (!text.trim()) return;

    // Slackのデフォルト送信を抑止
    event.preventDefault();
    event.stopPropagation();

    // 入力欄を保持
    currentInputField = inputField;

    // 添削フローを開始
    startProofreadFlow(text);
  }
};

/**
 * 添削フローを開始
 */
const startProofreadFlow = async (originalText: string): Promise<void> => {
  // コンテキストチェック
  if (!isExtensionContextValid()) {
    console.warn('[Slack Message Patch] Extension context invalidated. Please reload the page.');
    return;
  }

  try {
    // 設定を取得
    const settings = cachedSettings || (await loadSettings());

    // モーダルコールバック
    const callbacks: ModalCallbacks = {
      onSend: handleSend,
      onSendOriginal: () => {
        if (currentModal) {
          handleSendOriginal(currentModal.getCurrentOriginalText());
        }
      },
      onCancel: handleCancel,
      onRetry: () => {
        if (currentModal) {
          handleRetry(currentModal.getCurrentOriginalText());
        }
      },
      onPresetChange: (presetId) => {
        if (currentModal) {
          handlePresetChange(currentModal.getCurrentOriginalText(), presetId);
        }
      },
      onProofread: () => {
        if (currentModal) {
          handleProofread(currentModal.getCurrentOriginalText());
        }
      },
    };

    // モーダルを作成・表示（preview状態で開く）
    currentModal = new SlackPatchModal(callbacks);
    currentModal.show(originalText, settings);
  } catch (error) {
    console.error('[Slack Message Patch] Failed to start proofread flow:', error);
  }
};

/**
 * 添削リクエストを送信
 */
const requestProofread = (text: string, presetId?: string): void => {
  if (!isExtensionContextValid()) {
    if (currentModal) {
      currentModal.setError('拡張機能が更新されました。ページを再読み込みしてください。');
    }
    return;
  }

  const message: ProofreadRequest = {
    type: 'PROOFREAD',
    text,
    presetId,
  };

  try {
    chrome.runtime.sendMessage(message, (response: ProofreadResponse) => {
      if (chrome.runtime.lastError) {
        if (currentModal) {
          currentModal.setError('拡張機能との通信に失敗しました。ページを再読み込みしてください。');
        }
        return;
      }

      if (!currentModal) return;

      if (response.success) {
        currentModal.setResult(response.proofreadText);
      } else {
        currentModal.setError(response.error);
      }
    });
  } catch {
    if (currentModal) {
      currentModal.setError('拡張機能との通信に失敗しました。ページを再読み込みしてください。');
    }
  }
};

/**
 * 送信ハンドラ
 */
const handleSend = (text: string): void => {
  if (!currentModal || !currentInputField) return;

  currentModal.setSending();

  // 入力欄にテキストを設定
  const success = setInputText(text, currentInputField);

  if (success) {
    // 少し待ってから送信をトリガー（Slackのstate更新を待つ）
    setTimeout(() => {
      triggerSend(currentInputField);
      closeModal();
    }, 100);
  } else {
    // 設定失敗時はモーダルを閉じてユーザーに知らせる
    currentModal.setError('テキストの設定に失敗しました。手動でコピー&ペーストしてください。');
  }
};

/**
 * キャンセルハンドラ
 */
const handleCancel = (): void => {
  closeModal();
};

/**
 * リトライハンドラ
 */
const handleRetry = (originalText: string): void => {
  if (!currentModal) return;
  currentModal.setLoading();
  requestProofread(originalText);
};

/**
 * プリセット変更ハンドラ
 */
const handlePresetChange = (originalText: string, presetId: string): void => {
  if (!currentModal) return;

  // 設定を更新
  if (cachedSettings) {
    cachedSettings.activePresetId = presetId;
  }

  // 再度添削リクエスト
  currentModal.setLoading();
  requestProofread(originalText, presetId);
};

/**
 * 校正開始ハンドラ（preview状態から）
 */
const handleProofread = (originalText: string): void => {
  if (!currentModal) return;
  currentModal.setLoading();
  requestProofread(originalText);
};

/**
 * そのまま送信ハンドラ（preview状態から）
 */
const handleSendOriginal = (originalText: string): void => {
  if (!currentModal || !currentInputField) return;

  currentModal.setSending();

  // 入力欄に元のテキストを設定
  const success = setInputText(originalText, currentInputField);

  if (success) {
    // 少し待ってから送信をトリガー（Slackのstate更新を待つ）
    setTimeout(() => {
      triggerSend(currentInputField);
      closeModal();
    }, 100);
  } else {
    // 設定失敗時はモーダルを閉じてユーザーに知らせる
    currentModal.setError('テキストの設定に失敗しました。手動でコピー&ペーストしてください。');
  }
};

/**
 * モーダルを閉じる
 */
const closeModal = (): void => {
  if (currentModal) {
    currentModal.hide();
    currentModal = null;
  }
  currentInputField = null;
};

// 初期化を実行
initialize();
