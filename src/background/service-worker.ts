import type {
  ExtensionMessage,
  OpenAIChatCompletionResponse,
  ProofreadResponse,
  SettingsResponse,
} from '@/types';
import { API_TIMEOUT, OPENAI_API_ENDPOINT } from '@/utils/constants';
import { getActivePreset, getStorageData } from '@/utils/storage';

// メッセージリスナー
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ProofreadResponse | SettingsResponse) => void
  ) => {
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
        .then((settings) => sendResponse({ settings }))
        .catch(() => {
          // エラー時はデフォルト設定を返す
          import('@/utils/constants').then(({ DEFAULT_STORAGE_DATA }) => {
            sendResponse({ settings: DEFAULT_STORAGE_DATA });
          });
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
