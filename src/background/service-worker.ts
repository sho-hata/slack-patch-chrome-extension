import type {
  ContentSettings,
  ExtensionMessage,
  OpenAIChatCompletionResponse,
  ProofreadResponse,
  SettingsResponse,
  StorageData,
} from '@/types';
import { API_TIMEOUT, DEFAULT_CONTENT_SETTINGS, OPENAI_API_ENDPOINT } from '@/utils/constants';
import { getActivePreset, getStorageData } from '@/utils/storage';

/** StorageData から APIキーを除外し、Content Script 向けの設定に変換する */
const toContentSettings = (data: StorageData): ContentSettings => ({
  hasApiKey: !!data.apiKey,
  model: data.model,
  presets: data.presets,
  activePresetId: data.activePresetId,
  shortcut: data.shortcut,
});

/**
 * 送信元を検証する
 * 自分自身の拡張機能（コンテントスクリプト/オプションページ）からのメッセージのみ許可
 */
const isValidSender = (sender: chrome.runtime.MessageSender): boolean => {
  // 送信元の拡張機能IDが自分自身であることを確認
  if (sender.id !== chrome.runtime.id) {
    console.warn('[Slack Message Patch] Rejected message from external extension:', sender.id);
    return false;
  }

  // 送信元URLがあれば、それも検証（chrome-extension:// または許可されたホストか）
  if (sender.url) {
    const url = new URL(sender.url);
    // 自分の拡張機能ページからのリクエスト
    if (url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id) {
      return true;
    }
    // Slackのページからのコンテントスクリプト
    if (url.hostname === 'app.slack.com' || url.hostname.endsWith('.slack.com')) {
      return true;
    }
    console.warn('[Slack Message Patch] Rejected message from unexpected URL:', sender.url);
    return false;
  }

  // sender.urlがない場合（Service Workerなど）はIDチェックのみで許可
  return true;
};

// メッセージリスナー
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ProofreadResponse | SettingsResponse) => void
  ) => {
    if (!isValidSender(sender)) {
      return false;
    }

    if (message.type === 'PROOFREAD') {
      handleProofread(message.text, message.presetId)
        .then(sendResponse)
        .catch((error) => {
          console.error('Proofread error:', error);
          sendResponse({
            success: false,
            error: 'Unknown error occurred',
            errorType: 'NETWORK_ERROR',
          });
        });
      return true; // 非同期レスポンスを示す
    }

    if (message.type === 'GET_SETTINGS') {
      getStorageData()
        .then((settings) => sendResponse({ settings: toContentSettings(settings) }))
        .catch(() => {
          sendResponse({ settings: DEFAULT_CONTENT_SETTINGS });
        });
      return true;
    }

    return false;
  }
);

// 添削処理
async function handleProofread(text: string, presetId?: string): Promise<ProofreadResponse> {
  const settings = await getStorageData();

  // APIキーチェック
  if (!settings.apiKey) {
    return {
      success: false,
      error: 'APIキーが設定されていません。拡張機能のオプションページで設定してください。',
      errorType: 'NO_API_KEY',
    };
  }

  // プリセット取得
  let preset = presetId ? settings.presets.find((p) => p.id === presetId) : await getActivePreset();

  if (!preset) {
    preset = settings.presets[0];
  }

  if (!preset) {
    return {
      success: false,
      error: 'プリセットが見つかりません。',
      errorType: 'SERVER_ERROR',
    };
  }

  // OpenAI API 呼び出し
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    const response = await fetch(OPENAI_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: preset.systemPrompt },
          { role: 'user', content: preset.userPromptTemplate + text },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // エラーハンドリング
    if (!response.ok) {
      return handleApiError(response.status);
    }

    const data = (await response.json()) as OpenAIChatCompletionResponse;
    const proofreadText = data.choices[0]?.message?.content?.trim();

    if (!proofreadText) {
      return {
        success: false,
        error: 'APIからの応答が空でした。',
        errorType: 'SERVER_ERROR',
      };
    }

    return {
      success: true,
      proofreadText,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: 'リクエストがタイムアウトしました。',
        errorType: 'NETWORK_ERROR',
      };
    }

    return {
      success: false,
      error: `ネットワークエラー: ${error instanceof Error ? error.message : 'Unknown'}`,
      errorType: 'NETWORK_ERROR',
    };
  }
}

// APIエラーハンドリング
const handleApiError = (status: number): ProofreadResponse => {
  switch (status) {
    case 401:
      return {
        success: false,
        error: 'APIキーが無効です。設定を確認してください。',
        errorType: 'AUTH_ERROR',
      };
    case 429:
      return {
        success: false,
        error: 'APIのレート制限に達しました。しばらく待ってからお試しください。',
        errorType: 'RATE_LIMIT',
      };
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        success: false,
        error: 'OpenAI APIサーバーでエラーが発生しました。しばらく待ってからお試しください。',
        errorType: 'SERVER_ERROR',
      };
    default:
      return {
        success: false,
        error: `APIエラー (ステータス: ${status})`,
        errorType: 'SERVER_ERROR',
      };
  }
};

// 拡張機能インストール時の初期化
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // 初回インストール時はオプションページを開く
    chrome.runtime.openOptionsPage();
  }
});
