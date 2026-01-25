// プロンプトプリセット
export type Preset = {
  id: string;
  name: string;
  systemPrompt: string;
  userPromptTemplate: string;
};

// ストレージデータ構造
export type StorageData = {
  apiKey: string;
  model: string;
  presets: Preset[];
  activePresetId: string;
};

// Content Script → Service Worker メッセージ
export type MessageType = 'PROOFREAD' | 'GET_SETTINGS';

export type ProofreadRequest = {
  type: 'PROOFREAD';
  text: string;
  presetId?: string;
};

export type GetSettingsRequest = {
  type: 'GET_SETTINGS';
};

export type ExtensionMessage = ProofreadRequest | GetSettingsRequest;

// Service Worker → Content Script レスポンス
export type ProofreadSuccessResponse = {
  success: true;
  proofreadText: string;
};

export type ProofreadErrorResponse = {
  success: false;
  error: string;
  errorType: 'AUTH_ERROR' | 'RATE_LIMIT' | 'SERVER_ERROR' | 'NETWORK_ERROR' | 'NO_API_KEY';
};

export type ProofreadResponse = ProofreadSuccessResponse | ProofreadErrorResponse;

export type SettingsResponse = {
  settings: StorageData;
};

// モーダルの状態
export type ModalState = 'loading' | 'ready' | 'error' | 'sending';

// OpenAI API レスポンス型
export type OpenAIChatCompletionResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};
