/**
 * Slack Message Patch Options Page
 * 設定画面のロジック
 */

import type { Preset, ShortcutConfig, StorageData } from '@/types';
import { AVAILABLE_MODELS, DEFAULT_PRESETS, DEFAULT_SHORTCUT } from '@/utils/constants';
import {
  addPreset,
  deletePreset,
  generateId,
  getStorageData,
  setStorageData,
  updatePreset,
} from '@/utils/storage';

let apiKeyInput: HTMLInputElement;
let toggleApiKeyBtn: HTMLButtonElement;
let modelSelect: HTMLSelectElement;
let shortcutInput: HTMLInputElement;
let resetShortcutBtn: HTMLButtonElement;
let activePresetSelect: HTMLSelectElement;
let presetList: HTMLDivElement;
let addPresetBtn: HTMLButtonElement;

let presetModal: HTMLDivElement;
let modalTitle: HTMLHeadingElement;
let presetIdInput: HTMLInputElement;
let presetNameInput: HTMLInputElement;
let presetSystemInput: HTMLTextAreaElement;
let presetUserInput: HTMLTextAreaElement;
let deletePresetBtn: HTMLButtonElement;
let cancelPresetBtn: HTMLButtonElement;
let savePresetBtn: HTMLButtonElement;

let currentSettings: StorageData;

document.addEventListener('DOMContentLoaded', async () => {
  apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
  toggleApiKeyBtn = document.getElementById('toggle-api-key') as HTMLButtonElement;
  modelSelect = document.getElementById('model') as HTMLSelectElement;
  shortcutInput = document.getElementById('shortcut-input') as HTMLInputElement;
  resetShortcutBtn = document.getElementById('reset-shortcut') as HTMLButtonElement;
  activePresetSelect = document.getElementById('active-preset') as HTMLSelectElement;
  presetList = document.getElementById('preset-list') as HTMLDivElement;
  addPresetBtn = document.getElementById('add-preset') as HTMLButtonElement;

  presetModal = document.getElementById('preset-modal') as HTMLDivElement;
  modalTitle = document.getElementById('modal-title') as HTMLHeadingElement;
  presetIdInput = document.getElementById('preset-id') as HTMLInputElement;
  presetNameInput = document.getElementById('preset-name') as HTMLInputElement;
  presetSystemInput = document.getElementById('preset-system') as HTMLTextAreaElement;
  presetUserInput = document.getElementById('preset-user') as HTMLTextAreaElement;
  deletePresetBtn = document.getElementById('delete-preset') as HTMLButtonElement;
  cancelPresetBtn = document.getElementById('cancel-preset') as HTMLButtonElement;
  savePresetBtn = document.getElementById('save-preset') as HTMLButtonElement;

  populateModelSelect();
  await loadSettings();
  setupEventListeners();
});

const populateModelSelect = (): void => {
  for (const model of AVAILABLE_MODELS) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    modelSelect.appendChild(option);
  }
};

const loadSettings = async (): Promise<void> => {
  currentSettings = await getStorageData();
  apiKeyInput.value = currentSettings.apiKey;
  modelSelect.value = currentSettings.model;
  updateShortcutDisplay();
  renderPresetList();
  updateActivePresetSelect();
};

const updateShortcutDisplay = (): void => {
  const shortcut = currentSettings.shortcut || DEFAULT_SHORTCUT;
  shortcutInput.value = formatShortcut(shortcut);
};

const formatShortcut = (shortcut: ShortcutConfig): string => {
  const parts: string[] = [];

  if (shortcut.ctrlKey || shortcut.metaKey) {
    parts.push('Cmd/Ctrl');
  }
  if (shortcut.altKey) {
    parts.push('Alt');
  }
  if (shortcut.shiftKey) {
    parts.push('Shift');
  }

  let keyName = shortcut.key;
  if (keyName === ' ') keyName = 'Space';

  parts.push(keyName);

  return parts.join(' + ');
};

const renderPresetList = (): void => {
  presetList.innerHTML = '';

  for (const preset of currentSettings.presets) {
    const item = document.createElement('div');
    item.className = 'preset-item';
    item.innerHTML = `
      <div class="preset-item-info">
        <div class="preset-item-name">${escapeHtml(preset.name)}</div>
        <div class="preset-item-preview">${escapeHtml(preset.systemPrompt.substring(0, 60))}${preset.systemPrompt.length > 60 ? '...' : ''}</div>
      </div>
      <div class="preset-item-actions">
        <button type="button" class="btn btn-secondary btn-icon edit-preset" data-id="${preset.id}">編集</button>
      </div>
    `;
    presetList.appendChild(item);
  }

  for (const btn of presetList.querySelectorAll('.edit-preset')) {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLButtonElement).dataset.id!;
      openPresetModal(id);
    });
  }
};

const updateActivePresetSelect = (): void => {
  activePresetSelect.innerHTML = '';

  for (const preset of currentSettings.presets) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    option.selected = preset.id === currentSettings.activePresetId;
    activePresetSelect.appendChild(option);
  }
};

const setupEventListeners = (): void => {
  toggleApiKeyBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleApiKeyBtn.querySelector('.icon-eye')!.textContent = isPassword ? '🙈' : '👁';
  });

  apiKeyInput.addEventListener('change', async () => {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
      await setStorageData({ apiKey: '' });
      showToast('APIキーを削除しました');
      return;
    }

    await setStorageData({ apiKey });
    showToast('APIキーを保存しました');
  });

  modelSelect.addEventListener('change', async () => {
    await setStorageData({ model: modelSelect.value });
    currentSettings.model = modelSelect.value;
    showToast('モデルを保存しました');
  });

  shortcutInput.addEventListener('focus', () => {
    shortcutInput.classList.add('recording');
    shortcutInput.value = 'キーを押してください...';
  });

  shortcutInput.addEventListener('blur', () => {
    shortcutInput.classList.remove('recording');
    updateShortcutDisplay();
  });

  shortcutInput.addEventListener('keydown', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // 単独の修飾キーは無視
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
      return;
    }

    if (e.key === 'Escape') {
      shortcutInput.blur();
      return;
    }

    const newShortcut: ShortcutConfig = {
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
    };

    await setStorageData({ shortcut: newShortcut });
    currentSettings.shortcut = newShortcut;
    shortcutInput.classList.remove('recording');
    updateShortcutDisplay();
    showToast('ショートカットを保存しました');
    shortcutInput.blur();
  });

  resetShortcutBtn.addEventListener('click', async () => {
    await setStorageData({ shortcut: DEFAULT_SHORTCUT });
    currentSettings.shortcut = DEFAULT_SHORTCUT;
    updateShortcutDisplay();
    showToast('ショートカットをリセットしました');
  });

  activePresetSelect.addEventListener('change', async () => {
    await setStorageData({ activePresetId: activePresetSelect.value });
    currentSettings.activePresetId = activePresetSelect.value;
    showToast('アクティブプリセットを変更しました');
  });

  addPresetBtn.addEventListener('click', () => {
    openPresetModal();
  });

  presetModal.querySelector('.modal-overlay')?.addEventListener('click', closePresetModal);
  document.getElementById('modal-close')?.addEventListener('click', closePresetModal);
  cancelPresetBtn.addEventListener('click', closePresetModal);
  savePresetBtn.addEventListener('click', savePresetFromModal);
  deletePresetBtn.addEventListener('click', deletePresetFromModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !presetModal.classList.contains('hidden')) {
      closePresetModal();
    }
  });
};

const openPresetModal = (presetId?: string): void => {
  const preset = presetId ? currentSettings.presets.find((p) => p.id === presetId) : null;

  if (preset) {
    modalTitle.textContent = 'プリセットを編集';
    presetIdInput.value = preset.id;
    presetNameInput.value = preset.name;
    presetSystemInput.value = preset.systemPrompt;
    presetUserInput.value = preset.userPromptTemplate;
    deletePresetBtn.style.display = 'block';

    // デフォルトプリセットは削除不可
    const isDefault = DEFAULT_PRESETS.some((p) => p.id === preset.id);
    deletePresetBtn.disabled = isDefault;
    if (isDefault) {
      deletePresetBtn.title = 'デフォルトプリセットは削除できません';
    } else {
      deletePresetBtn.title = '';
    }
  } else {
    modalTitle.textContent = '新しいプリセット';
    presetIdInput.value = '';
    presetNameInput.value = '';
    presetSystemInput.value = '';
    presetUserInput.value = '';
    deletePresetBtn.style.display = 'none';
  }

  presetModal.classList.remove('hidden');
  presetNameInput.focus();
};

const closePresetModal = (): void => {
  presetModal.classList.add('hidden');
};

const savePresetFromModal = async (): Promise<void> => {
  const name = presetNameInput.value.trim();
  const systemPrompt = presetSystemInput.value.trim();
  const userPromptTemplate = presetUserInput.value.trim();

  if (!name) {
    alert('プリセット名を入力してください');
    presetNameInput.focus();
    return;
  }

  if (!systemPrompt) {
    alert('システムプロンプトを入力してください');
    presetSystemInput.focus();
    return;
  }

  const existingId = presetIdInput.value;

  if (existingId) {
    await updatePreset(existingId, { name, systemPrompt });

    const index = currentSettings.presets.findIndex((p) => p.id === existingId);
    if (index !== -1) {
      currentSettings.presets[index] = {
        ...currentSettings.presets[index],
        name,
        systemPrompt,
        userPromptTemplate,
      };
    }
  } else {
    const newPreset: Preset = {
      id: generateId(),
      name,
      systemPrompt,
      userPromptTemplate,
    };
    await addPreset(newPreset);
    currentSettings.presets.push(newPreset);
  }

  renderPresetList();
  updateActivePresetSelect();
  closePresetModal();
  showToast('プリセットを保存しました');
};

const deletePresetFromModal = async (): Promise<void> => {
  const id = presetIdInput.value;
  if (!id) return;

  if (!confirm('このプリセットを削除してもよろしいですか？')) {
    return;
  }

  await deletePreset(id);

  currentSettings.presets = currentSettings.presets.filter((p) => p.id !== id);

  // 削除したのがアクティブなプリセットだった場合
  if (currentSettings.activePresetId === id && currentSettings.presets.length > 0) {
    currentSettings.activePresetId = currentSettings.presets[0].id;
  }

  renderPresetList();
  updateActivePresetSelect();
  closePresetModal();
  showToast('プリセットを削除しました');
};

const showToast = (message: string): void => {
  const existingToast = document.querySelector('.save-toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'save-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
};

const escapeHtml = (text: string): string => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};
