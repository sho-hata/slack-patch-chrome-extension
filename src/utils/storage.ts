import type { Preset, StorageData } from '@/types';
import { DEFAULT_STORAGE_DATA, STORAGE_KEY } from './constants';

// 常にディープコピーを返すことで、定数オブジェクトの意図しない変更を防ぐ
export async function getStorageData(): Promise<StorageData> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const data = result[STORAGE_KEY] as StorageData | undefined;
      if (data) {
        // デフォルト値とマージして不足フィールドを補完
        const defaults = structuredClone(DEFAULT_STORAGE_DATA);
        resolve({
          ...defaults,
          ...data,
        });
      } else {
        resolve(structuredClone(DEFAULT_STORAGE_DATA));
      }
    });
  });
}

export async function setStorageData(data: Partial<StorageData>): Promise<void> {
  const current = await getStorageData();
  const updated = { ...current, ...data };

  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: updated }, () => {
      resolve();
    });
  });
}

export async function saveApiKey(apiKey: string): Promise<void> {
  await setStorageData({ apiKey });
}

export async function getApiKey(): Promise<string> {
  const data = await getStorageData();
  return data.apiKey;
}

export async function saveModel(model: string): Promise<void> {
  await setStorageData({ model });
}

export async function setActivePreset(presetId: string): Promise<void> {
  await setStorageData({ activePresetId: presetId });
}

export async function getActivePreset(): Promise<Preset | undefined> {
  const data = await getStorageData();
  return data.presets.find((p) => p.id === data.activePresetId);
}

export async function addPreset(preset: Preset): Promise<void> {
  const data = await getStorageData();
  await setStorageData({
    presets: [...data.presets, preset],
  });
}

export async function updatePreset(presetId: string, updates: Partial<Preset>): Promise<void> {
  const data = await getStorageData();
  const presets = data.presets.map((p) => (p.id === presetId ? { ...p, ...updates } : p));
  await setStorageData({ presets });
}

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

export const generateId = (): string => {
  return crypto.randomUUID();
};
