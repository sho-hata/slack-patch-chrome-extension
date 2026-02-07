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

const SEND_BUTTON_SELECTORS = [
  '[data-qa="texty_send_button"]',
  '.c-wysiwyg_container__button--send',
  '[aria-label="Send message"]',
  '[aria-label="メッセージを送信"]',
  'button[data-qa="send_button"]',
];

let cachedInputField: HTMLElement | null = null;

export const findActiveInputField = (): HTMLElement | null => {
  const activeElement = document.activeElement as HTMLElement;
  if (activeElement && isValidInputField(activeElement)) {
    cachedInputField = activeElement;
    return activeElement;
  }

  for (const selector of INPUT_SELECTORS) {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    for (const element of elements) {
      if (isValidInputField(element)) {
        if (isVisible(element)) {
          cachedInputField = element;
          return element;
        }
      }
    }
  }

  if (cachedInputField && document.contains(cachedInputField)) {
    return cachedInputField;
  }

  return null;
};

const isValidInputField = (element: HTMLElement): boolean => {
  return (
    element.getAttribute('contenteditable') === 'true' && !element.closest('[aria-hidden="true"]')
  );
};

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

  const text = extractTextWithFormatting(field);
  return text.replace(/^\n+/, '').replace(/\n+$/, '');
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
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    const tag = el.tagName;

    // data-stringify-type属性でコードブロックを検出（Slack特有）
    const stringifyType = el.getAttribute('data-stringify-type');
    if (stringifyType === 'pre') {
      const codeContent = el.textContent || '';
      return `\`\`\`\n${codeContent}\n\`\`\``;
    }

    if (
      el.classList.contains('c-mrkdwn__pre') ||
      el.classList.contains('c-code_block') ||
      el.classList.contains('ql-code-block-container') ||
      el.classList.contains('ql-code-block')
    ) {
      const codeContent = el.textContent || '';
      return `\`\`\`\n${codeContent}\n\`\`\``;
    }

    const inner = Array.from(el.childNodes).map(extractTextWithFormatting).join('');

    switch (tag) {
      case 'B':
      case 'STRONG':
        return `*${inner}*`;

      case 'I':
      case 'EM':
        return `_${inner}_`;

      case 'CODE':
        // 親がPREの場合はコードブロック内なのでそのまま返す
        if (el.parentElement?.tagName === 'PRE') {
          return inner;
        }
        return `\`${inner}\``;

      case 'S':
      case 'DEL':
      case 'STRIKE':
        return `~${inner}~`;

      case 'PRE':
        return `\`\`\`\n${inner}\n\`\`\``;

      case 'BLOCKQUOTE': {
        const lines = inner.split('\n').filter((line) => line.trim() !== '');
        return `${lines.map((line) => `> ${line}`).join('\n')}\n`;
      }

      case 'BR':
        return '\n';

      case 'IMG': {
        // data-stringify-text属性を優先（Slackの絵文字ショートコード）
        const stringifyText = el.getAttribute('data-stringify-text');
        if (stringifyText?.startsWith(':') && stringifyText.endsWith(':')) {
          return stringifyText;
        }

        const dataId = el.getAttribute('data-id');
        if (dataId?.startsWith(':') && dataId.endsWith(':')) {
          return dataId;
        }

        // data-stringify-emoji属性をチェック（旧形式）
        if (el.dataset.stringifyEmoji) {
          return el.dataset.stringifyEmoji;
        }

        const dataEmoji = el.dataset.emoji;
        if (dataEmoji) {
          return `:${dataEmoji}:`;
        }

        return '';
      }

      case 'A': {
        const href = el.getAttribute('href');
        // URLとテキストが同じ場合はテキストのみ、異なる場合はSlack形式
        if (href && inner && href !== inner) {
          return `<${href}|${inner}>`;
        }
        return inner || href || '';
      }

      case 'UL':
        return inner;

      case 'OL':
        return inner;

      case 'LI': {
        const parent = el.parentElement;
        if (parent?.tagName === 'OL') {
          const items = Array.from(parent.children);
          const index = items.indexOf(el) + 1;
          return `${index}. ${inner}\n`;
        }
        return `• ${inner}\n`;
      }

      // ブロック要素（改行を含む）
      case 'P':
      case 'DIV':
        if (inner.trim()) {
          return `${inner}\n`;
        }
        return inner;

      default:
        return inner;
    }
  }

  return '';
};

interface PatternMatch {
  index: number;
  length: number;
  content: string;
  tag: string;
  href?: string;
}

const findEarliestMatch = (text: string): PatternMatch | null => {
  const matches: PatternMatch[] = [];

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
      if (earliestMatch.index > 0) {
        fragment.appendChild(document.createTextNode(remaining.substring(0, earliestMatch.index)));
      }

      const el = document.createElement(earliestMatch.tag);
      el.textContent = earliestMatch.content;
      if (earliestMatch.tag === 'a' && earliestMatch.href) {
        (el as HTMLAnchorElement).href = earliestMatch.href;
      }
      fragment.appendChild(el);

      remaining = remaining.substring(earliestMatch.index + earliestMatch.length);
    } else {
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

  const codeBlockRegex = /```\n?([\s\S]*?)\n?```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  // biome-ignore lint/suspicious/noAssignInExpressions: RegExp.exec requires assignment in condition
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const beforeText = text.substring(lastIndex, match.index);
      processInlineText(beforeText, fragment);
    }

    const pre = document.createElement('pre');
    pre.textContent = match[1];
    fragment.appendChild(pre);

    lastIndex = match.index + match[0].length;
  }

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
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('> ') || line === '>') {
      const blockquote = document.createElement('blockquote');
      const quoteLines: string[] = [];

      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        const content = lines[i].startsWith('> ') ? lines[i].substring(2) : '';
        quoteLines.push(content);
        i++;
      }

      quoteLines.forEach((quoteLine, index) => {
        if (index > 0) {
          blockquote.appendChild(document.createElement('br'));
        }
        if (quoteLine) {
          blockquote.appendChild(parseSlackMarkdownLine(quoteLine));
        }
      });

      fragment.appendChild(blockquote);
    } else {
      const p = document.createElement('p');
      if (line) {
        p.appendChild(parseSlackMarkdownLine(line));
      }
      fragment.appendChild(p);
      i++;
    }
    if (line) {
      fragment.appendChild(parseSlackMarkdownLine(line));
    }
  }
};

/**
 * 入力欄にテキストを設定（Slackマークダウン対応）
 */
export const setInputText = (text: string, inputField?: HTMLElement | null): boolean => {
  const field = inputField || findActiveInputField();
  if (!field) return false;

  try {
    field.focus();
    field.innerHTML = '';

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
  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
    })
  );

  element.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
    })
  );

  element.dispatchEvent(
    new Event('change', {
      bubbles: true,
      cancelable: true,
    })
  );
};

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

const findSendButton = (inputField: HTMLElement): HTMLElement | null => {
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

export const clearInputField = (inputField?: HTMLElement | null): boolean => {
  const field = inputField || findActiveInputField();
  if (!field) return false;

  field.innerHTML = '';
  dispatchInputEvents(field);
  return true;
};
