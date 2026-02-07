import type { ContentSettings, Preset, ShortcutConfig, StorageData } from '@/types';

export const DEFAULT_PRESETS: Preset[] = [
  {
    id: 'business-proofreading',
    name: 'ビジネス文章校正',
    systemPrompt:
      'あなたは優秀な文章校正者です。Slackメッセージを読みやすく、丁寧かつ簡潔に校正してください。元の意図を保ちつつ、より明確で適切な表現に修正してください。元の文章に絵文字（例: :+1: :pray: など）やフォーマット記号（*太字*, _イタリック_, `コード`, ~取り消し線~）がある場合はそのまま残してください。',
    userPromptTemplate:
      '次のSlackメッセージを添削してください。添削後のテキストのみを返してください：\n\n',
  },
  {
    id: 'casual-proofreading',
    name: 'カジュアル校正',
    systemPrompt:
      'あなたは文章校正者です。Slackメッセージを読みやすく校正してください。カジュアルな雰囲気は保ちつつ、誤字脱字や分かりにくい表現を修正してください。元の文章に絵文字（例: :+1: :pray: など）やフォーマット記号（*太字*, _イタリック_, `コード`, ~取り消し線~）がある場合はそのまま残してください。',
    userPromptTemplate:
      '次のSlackメッセージを校正してください。校正後のテキストのみを返してください：\n\n',
  },
];

export const DEFAULT_SHORTCUT: ShortcutConfig = {
  key: 'Enter',
  ctrlKey: false,
  metaKey: true, // Cmd on Mac
  altKey: false,
  shiftKey: false,
};

export const DEFAULT_STORAGE_DATA: StorageData = {
  apiKey: '',
  model: 'gpt-4o-mini',
  presets: DEFAULT_PRESETS,
  activePresetId: 'business-proofreading',
  shortcut: DEFAULT_SHORTCUT,
};

export const DEFAULT_CONTENT_SETTINGS: ContentSettings = {
  hasApiKey: false,
  model: DEFAULT_STORAGE_DATA.model,
  presets: DEFAULT_STORAGE_DATA.presets,
  activePresetId: DEFAULT_STORAGE_DATA.activePresetId,
  shortcut: DEFAULT_STORAGE_DATA.shortcut,
};

export const AVAILABLE_MODELS = [
  { id: 'gpt-4o-mini', name: 'GPT-4o mini (推奨)' },
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-5', name: 'GPT-5' },
  { id: 'gpt-5-mini', name: 'GPT-5 mini' },
] as const;

export const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export const API_TIMEOUT = 30000;

export const STORAGE_KEY = 'slackPatchSettings';
