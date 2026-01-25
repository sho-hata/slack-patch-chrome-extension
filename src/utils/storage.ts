import type { Preset, StorageData } from '@/types';
import { DEFAULT_STORAGE_DATA, STORAGE_KEY } from './constants';

// ストレージからデータを取得
export async function getStorageData(): Promise<StorageData> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const data = result[STORAGE_KEY] as StorageData | undefined;
      if (data) {
        // デフォルト値とマージして不足フィールドを補完
        resolve({
          ...DEFAULT_STORAGE_DATA,
          ...data,
        });
      } else {
        resolve(DEFAULT_STORAGE_DATA);
      }
    });
  });
}

// ストレージにデータを保存
export async function setStorageData(data: Partial<StorageData>): Promise<void> {
  const current = await getStorageData();
  const updated = { ...current, ...data };

  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: updated }, () => {
      resolve();
    });
  });
}

// APIキーを保存
export async function saveApiKey(apiKey: string): Promise<void> {
  await setStorageData({ apiKey });
}

// APIキーを取得
export async function getApiKey(): Promise<string> {
  const data = await getStorageData();
  return data.apiKey;
}

// モデルを保存
export async function saveModel(model: string): Promise<void> {
  await setStorageData({ model });
}

// アクティブなプリセットを設定
export async function setActivePreset(presetId: string): Promise<void> {
  await setStorageData({ activePresetId: presetId });
}

// アクティブなプリセットを取得
export async function getActivePreset(): Promise<Preset | undefined> {
  const data = await getStorageData();
  return data.presets.find((p) => p.id === data.activePresetId);
}

// プリセットを追加
export async function addPreset(preset: Preset): Promise<void> {
  const data = await getStorageData();
  await setStorageData({
    presets: [...data.presets, preset],
  });
}

// プリセットを更新
export async function updatePreset(presetId: string, updates: Partial<Preset>): Promise<void> {
  const data = await getStorageData();
  const presets = data.presets.map((p) => (p.id === presetId ? { ...p, ...updates } : p));
  await setStorageData({ presets });
}

// プリセットを削除
export async function deletePreset(presetId: string): Promise<void> {
  const data = await getStorageData();
  const presets = data.presets.filter((p) => p.id !== presetId);

  // 削除対象がアクティブなプリセットの場合、最初のプリセットをアクティブに
  let activePresetId = data.activePresetId;
  if (activePresetId === presetId && presets.length > 0) {
    activePresetId = presets[0].id;
  }

  await setStorageData({ presets, activePresetId });
}

// UUIDを生成（プリセットID用）
export const generateId = (): string => {
  return crypto.randomUUID();
};
