/**
 * Slack DOM操作ユーティリティ
 * Web版Slackの入力欄を検出し、テキストの取得・反映・送信を行う
 */

// 入力欄のセレクタ候補（優先度順）
const INPUT_SELECTORS = [
  // メインメッセージ入力欄
  '[data-qa="message_input"] [contenteditable="true"]',
  '[data-qa="message-input"] [contenteditable="true"]',
  // スレッド入力欄
  '.p-threads_view__input [contenteditable="true"]',
  // フォールバック
  '.ql-editor[contenteditable="true"]',
  '[data-message-input] [contenteditable="true"]',
  '.c-texty_input [contenteditable="true"]',
];

// 送信ボタンのセレクタ候補
const SEND_BUTTON_SELECTORS = [
  '[data-qa="texty_send_button"]',
  '.c-wysiwyg_container__button--send',
  '[aria-label="Send message"]',
  '[aria-label="メッセージを送信"]',
  'button[data-qa="send_button"]',
];

// 現在アクティブな入力欄をキャッシュ
let cachedInputField: HTMLElement | null = null;

/**
 * アクティブな入力欄を検出
 */
export const findActiveInputField = (): HTMLElement | null => {
  // フォーカスされている要素をチェック
  const activeElement = document.activeElement as HTMLElement;
  if (activeElement && isValidInputField(activeElement)) {
    cachedInputField = activeElement;
    return activeElement;
  }

  // セレクタで探索
  for (const selector of INPUT_SELECTORS) {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    for (const element of elements) {
      if (isValidInputField(element)) {
        // 可視性チェック
        if (isVisible(element)) {
          cachedInputField = element;
          return element;
        }
      }
    }
  }

  // キャッシュがあれば返す
  if (cachedInputField && document.contains(cachedInputField)) {
    return cachedInputField;
  }

  return null;
};

/**
 * 有効な入力欄かどうかを判定
 */
const isValidInputField = (element: HTMLElement): boolean => {
  return (
    element.getAttribute('contenteditable') === 'true' && !element.closest('[aria-hidden="true"]')
  );
};

/**
 * 要素が可視かどうかを判定
 */
const isVisible = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
};

/**
 * 入力欄からテキストを取得（リッチテキスト・絵文字対応）
 */
export const getInputText = (inputField?: HTMLElement | null): string => {
  const field = inputField || findActiveInputField();
  if (!field) return '';

  // DOMを走査してテキスト、絵文字、フォーマットを取得
  const text = extractTextWithFormatting(field);

  // 末尾の改行を削除
  return text.replace(/\n$/, '');
};

/**
 * DOM要素からテキスト、絵文字、リッチテキストフォーマットを抽出
 * リッチテキストはSlackマークダウン形式に変換:
 * - 太字: *text*
 * - イタリック: _text_
 * - コード: `text`
 * - 取り消し線: ~text~
 * - コードブロック: ```text```
 * - 絵文字: :emoji:
 * - リンク: <URL|text> または text
 * - リスト: • item
 */
const extractTextWithFormatting = (node: Node): string => {
  // テキストノード
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  // 要素ノード
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    const tag = el.tagName;

    // 子要素を再帰的に処理
    const inner = Array.from(el.childNodes).map(extractTextWithFormatting).join('');

    // フォーマット変換
    switch (tag) {
      // 太字
      case 'B':
      case 'STRONG':
        return `*${inner}*`;

      // イタリック
      case 'I':
      case 'EM':
        return `_${inner}_`;

      // インラインコード
      case 'CODE':
        // 親がPREの場合はコードブロック内なのでそのまま返す
        if (el.parentElement?.tagName === 'PRE') {
          return inner;
        }
        return `\`${inner}\``;

      // 取り消し線
      case 'S':
      case 'DEL':
      case 'STRIKE':
        return `~${inner}~`;

      // コードブロック
      case 'PRE':
        return `\`\`\`\n${inner}\n\`\`\``;

      // 改行
      case 'BR':
        return '\n';

      // 絵文字
      case 'IMG': {
        // data-stringify-emoji属性を優先
        if (el.dataset.stringifyEmoji) {
          return el.dataset.stringifyEmoji;
        }

        // aria-label属性をチェック（:emoji: 形式の場合あり）
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) {
          // 既に :emoji: 形式の場合はそのまま返す
          if (ariaLabel.startsWith(':') && ariaLabel.endsWith(':')) {
            return ariaLabel;
          }
          // 「emoji 絵文字」形式の場合は :emoji: に変換
          const emojiMatch = ariaLabel.match(/^(.+?)(?:\s+絵文字)?$/);
          if (emojiMatch) {
            return `:${emojiMatch[1]}:`;
          }
        }

        // alt属性をチェック
        const alt = el.getAttribute('alt');
        if (alt) {
          // 既に :emoji: 形式の場合はそのまま返す
          if (alt.startsWith(':') && alt.endsWith(':')) {
            return alt;
          }
          // 「emoji 絵文字」形式の場合は :emoji: に変換
          const altMatch = alt.match(/^(.+?)(?:\s+絵文字)?$/);
          if (altMatch) {
            return `:${altMatch[1]}:`;
          }
          return `:${alt}:`;
        }

        // data-emoji属性もチェック
        const dataEmoji = el.dataset.emoji;
        if (dataEmoji) {
          return `:${dataEmoji}:`;
        }

        return '';
      }

      // リンク
      case 'A': {
        const href = el.getAttribute('href');
        // URLとテキストが同じ場合はテキストのみ、異なる場合はSlack形式
        if (href && inner && href !== inner) {
          return `<${href}|${inner}>`;
        }
        return inner || href || '';
      }

      // 箇条書きリスト
      case 'UL':
        return inner;

      // 番号付きリスト
      case 'OL':
        return inner;

      // リストアイテム
      case 'LI': {
        const parent = el.parentElement;
        if (parent?.tagName === 'OL') {
          // 番号付きリスト: 親要素内での位置を取得
          const items = Array.from(parent.children);
          const index = items.indexOf(el) + 1;
          return `${index}. ${inner}\n`;
        }
        // 箇条書き
        return `• ${inner}\n`;
      }

      // ブロック要素（改行を含む）
      case 'P':
      case 'DIV':
        // 空でない場合のみ改行を追加
        if (inner.trim()) {
          return `${inner}\n`;
        }
        return inner;

      // その他の要素は子要素のテキストを返す
      default:
        return inner;
    }
  }

  return '';
};

// マークダウンパターンマッチの型
interface PatternMatch {
  index: number;
  length: number;
  content: string;
  tag: string;
  href?: string;
}

/**
 * 最も早いマッチを見つける
 */
const findEarliestMatch = (text: string): PatternMatch | null => {
  const matches: PatternMatch[] = [];

  // リンクパターン <URL|text>
  const linkMatch = text.match(/<([^|>]+)\|([^>]+)>/);
  if (linkMatch && linkMatch.index !== undefined) {
    matches.push({
      index: linkMatch.index,
      length: linkMatch[0].length,
      content: linkMatch[2],
      tag: 'a',
      href: linkMatch[1],
    });
  }

  // 通常のフォーマットパターン
  const patterns = [
    { regex: /`([^`]+)`/, tag: 'code' },
    { regex: /\*([^*]+)\*/, tag: 'b' },
    { regex: /_([^_]+)_/, tag: 'i' },
    { regex: /~([^~]+)~/, tag: 's' },
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match && match.index !== undefined) {
      matches.push({
        index: match.index,
        length: match[0].length,
        content: match[1],
        tag: pattern.tag,
      });
    }
  }

  if (matches.length === 0) return null;

  // 最も早いマッチを返す
  return matches.reduce((earliest, current) =>
    current.index < earliest.index ? current : earliest
  );
};

/**
 * Slackマークダウンをインラインで処理してDOM要素を作成
 * 対応フォーマット: *太字*, _イタリック_, `コード`, ~取り消し線~, <URL|text>
 */
const parseSlackMarkdownLine = (line: string): DocumentFragment => {
  const fragment = document.createDocumentFragment();

  let remaining = line;

  while (remaining.length > 0) {
    const earliestMatch = findEarliestMatch(remaining);

    if (earliestMatch) {
      // マッチ前のテキストを追加
      if (earliestMatch.index > 0) {
        fragment.appendChild(document.createTextNode(remaining.substring(0, earliestMatch.index)));
      }

      // フォーマット要素を作成
      const el = document.createElement(earliestMatch.tag);
      el.textContent = earliestMatch.content;
      if (earliestMatch.tag === 'a' && earliestMatch.href) {
        (el as HTMLAnchorElement).href = earliestMatch.href;
      }
      fragment.appendChild(el);

      // 残りを更新
      remaining = remaining.substring(earliestMatch.index + earliestMatch.length);
    } else {
      // マッチがなければ残り全部をテキストとして追加
      fragment.appendChild(document.createTextNode(remaining));
      break;
    }
  }

  return fragment;
};

/**
 * Slackマークダウンを含むテキストをHTMLに変換
 * コードブロック（```）を先に処理してから、各行のインラインフォーマットを処理
 */
const convertMarkdownToHtml = (text: string): DocumentFragment => {
  const fragment = document.createDocumentFragment();

  // コードブロックを分離
  const codeBlockRegex = /```\n?([\s\S]*?)\n?```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  // biome-ignore lint/suspicious/noAssignInExpressions: RegExp.exec requires assignment in condition
  while ((match = codeBlockRegex.exec(text)) !== null) {
    // コードブロック前のテキストを処理
    if (match.index > lastIndex) {
      const beforeText = text.substring(lastIndex, match.index);
      processInlineText(beforeText, fragment);
    }

    // コードブロックを追加
    const pre = document.createElement('pre');
    pre.textContent = match[1];
    fragment.appendChild(pre);

    lastIndex = match.index + match[0].length;
  }

  // 残りのテキストを処理
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    processInlineText(remainingText, fragment);
  }

  return fragment;
};

/**
 * インラインテキストを行ごとに処理してフラグメントに追加
 */
const processInlineText = (text: string, fragment: DocumentFragment): void => {
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (index > 0) {
      fragment.appendChild(document.createElement('br'));
    }
    if (line) {
      fragment.appendChild(parseSlackMarkdownLine(line));
    }
  });
};

/**
 * 入力欄にテキストを設定（Slackマークダウン対応）
 */
export const setInputText = (text: string, inputField?: HTMLElement | null): boolean => {
  const field = inputField || findActiveInputField();
  if (!field) return false;

  try {
    // フォーカスを設定
    field.focus();

    // テキストをクリアして設定
    field.innerHTML = '';

    // マークダウンを含むテキストをHTMLに変換して設定
    const htmlContent = convertMarkdownToHtml(text);
    field.appendChild(htmlContent);

    // Slackに変更を通知するためのイベントを発火
    dispatchInputEvents(field);

    return true;
  } catch (error) {
    console.error('Failed to set input text:', error);
    return false;
  }
};

/**
 * 入力イベントを発火してSlackに変更を通知
 */
const dispatchInputEvents = (element: HTMLElement): void => {
  // input イベント
  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
    })
  );

  // beforeinput イベント
  element.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
    })
  );

  // change イベント
  element.dispatchEvent(
    new Event('change', {
      bubbles: true,
      cancelable: true,
    })
  );
};

/**
 * 送信をトリガー
 */
export const triggerSend = (inputField?: HTMLElement | null): boolean => {
  const field = inputField || findActiveInputField();
  if (!field) return false;

  try {
    // 方法1: 送信ボタンをクリック
    const sendButton = findSendButton(field);
    if (sendButton) {
      sendButton.click();
      return true;
    }

    // 方法2: Enterキーイベントを発火
    field.focus();
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    });
    field.dispatchEvent(enterEvent);

    return true;
  } catch (error) {
    console.error('Failed to trigger send:', error);
    return false;
  }
};

/**
 * 送信ボタンを探す
 */
const findSendButton = (inputField: HTMLElement): HTMLElement | null => {
  // 入力欄の親要素から送信ボタンを探す
  const container =
    inputField.closest('.c-wysiwyg_container') ||
    inputField.closest('[data-qa="message_input"]') ||
    inputField.closest('[data-qa="message-input"]') ||
    inputField.closest('.p-message_input');

  if (container) {
    for (const selector of SEND_BUTTON_SELECTORS) {
      const button = container.querySelector<HTMLElement>(selector);
      if (button && isVisible(button)) {
        return button;
      }
    }
  }

  // グローバルに探す
  for (const selector of SEND_BUTTON_SELECTORS) {
    const buttons = document.querySelectorAll<HTMLElement>(selector);
    for (const button of buttons) {
      if (isVisible(button)) {
        return button;
      }
    }
  }

  return null;
};

/**
 * 入力欄のDOM変更を監視
 * 入力欄が再生成された場合に対応
 */
export const observeInputField = (
  callback: (inputField: HTMLElement) => void
): MutationObserver => {
  const observer = new MutationObserver(() => {
    const inputField = findActiveInputField();
    if (inputField && inputField !== cachedInputField) {
      cachedInputField = inputField;
      callback(inputField);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return observer;
};

/**
 * 入力欄をクリア
 */
export const clearInputField = (inputField?: HTMLElement | null): boolean => {
  const field = inputField || findActiveInputField();
  if (!field) return false;

  field.innerHTML = '';
  dispatchInputEvents(field);
  return true;
};
