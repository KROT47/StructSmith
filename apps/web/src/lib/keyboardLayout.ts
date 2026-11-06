/**
 * QWERTY characters and the ЙЦУКЕН characters on the same physical keys.
 * Shortcuts compare the English character; this map makes the Russian layout match.
 */
const RUSSIAN_BY_ENGLISH: Record<string, string> = {
  q: "й",
  w: "ц",
  e: "у",
  r: "к",
  t: "е",
  y: "н",
  u: "г",
  i: "ш",
  o: "щ",
  p: "з",
  "[": "х",
  "]": "ъ",
  a: "ф",
  s: "ы",
  d: "в",
  f: "а",
  g: "п",
  h: "р",
  j: "о",
  k: "л",
  l: "д",
  ";": "ж",
  "'": "э",
  z: "я",
  x: "ч",
  c: "с",
  v: "м",
  b: "и",
  n: "т",
  m: "ь",
  ",": "б",
  ".": "ю",
  "/": ".",
  "`": "ё",
};

const CODE_BY_ENGLISH: Record<string, string> = {
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  ";": "Semicolon",
  "'": "Quote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
};

type LayoutKeyEvent = Pick<KeyboardEvent, "key" | "code" | "shiftKey">;

const fold = (key: string): string => (key.length === 1 ? key.toLowerCase() : key);

const physicalCode = (englishKey: string): string | undefined => {
  if (/^[a-z]$/.test(englishKey)) return `Key${englishKey.toUpperCase()}`;
  if (/^[0-9]$/.test(englishKey)) return `Digit${englishKey}`;
  return CODE_BY_ENGLISH[englishKey];
};

const samePhysicalKey = (event: LayoutKeyEvent, englishKey: string): boolean => {
  const code = physicalCode(englishKey);
  if (!code || event.code !== code) return false;
  // Letters keep matching with Shift, as `F` and `f` are the same shortcut.
  // Symbols do not: Shift on `-` produces `_`, not another press of `-`.
  return /^[a-z]$/.test(englishKey) || event.shiftKey !== true;
};

/**
 * True when `event` is one of the English shortcut keys or the same physical
 * key on a Russian ЙЦУКЕН layout. `i` also matches `ш`.
 */
export function matchesLayoutKey(
  event: LayoutKeyEvent,
  ...expectedKeys: readonly string[]
): boolean {
  return expectedKeys.some((expected) => {
    const englishKey = fold(expected);
    const pressed = fold(event.key);
    if (pressed === englishKey) return true;
    if (samePhysicalKey(event, englishKey)) return true;
    const russian = RUSSIAN_BY_ENGLISH[englishKey];
    if (!russian || pressed !== russian) return false;
    const code = physicalCode(englishKey);
    // `.` is both the English period and the Russian slash key. Trust the
    // physical key when the event identifies one.
    return !code || !event.code || event.code === code;
  });
}
