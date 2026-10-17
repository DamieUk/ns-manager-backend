// Amounts in Ukrainian words for documents: 7599.96 → «сім тисяч п’ятсот дев’яносто дев’ять
// гривень 96 копійок».

const ONES_MASCULINE = ['', 'один', 'два', 'три', 'чотири', 'п’ять', 'шість', 'сім', 'вісім', 'дев’ять'];
const ONES_FEMININE = ['', 'одна', 'дві', 'три', 'чотири', 'п’ять', 'шість', 'сім', 'вісім', 'дев’ять'];
const TEENS = [
  'десять',
  'одинадцять',
  'дванадцять',
  'тринадцять',
  'чотирнадцять',
  'п’ятнадцять',
  'шістнадцять',
  'сімнадцять',
  'вісімнадцять',
  'дев’ятнадцять',
];
const TENS = ['', '', 'двадцять', 'тридцять', 'сорок', 'п’ятдесят', 'шістдесят', 'сімдесят', 'вісімдесят', 'дев’яносто'];
const HUNDREDS = ['', 'сто', 'двісті', 'триста', 'чотириста', 'п’ятсот', 'шістсот', 'сімсот', 'вісімсот', 'дев’ятсот'];

type Forms = [one: string, few: string, many: string];

// 1 гривня, 2 гривні, 5 гривень, 11 гривень, 21 гривня.
export function plural(n: number, [one, few, many]: Forms): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

// 0 < n < 1000.
function triad(n: number, feminine: boolean): string[] {
  const words = [HUNDREDS[Math.floor(n / 100)]];
  const rest = n % 100;
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]);
  else words.push(TENS[Math.floor(rest / 10)], (feminine ? ONES_FEMININE : ONES_MASCULINE)[rest % 10]);
  return words.filter(Boolean);
}

const SCALES: Array<{ forms: Forms; feminine: boolean }> = [
  { forms: ['', '', ''], feminine: true }, // units: гривня is feminine
  { forms: ['тисяча', 'тисячі', 'тисяч'], feminine: true },
  { forms: ['мільйон', 'мільйони', 'мільйонів'], feminine: false },
  { forms: ['мільярд', 'мільярди', 'мільярдів'], feminine: false },
];

// A whole number of hryvnias in words (feminine: «одна», «дві»).
export function integerInWords(n: number): string {
  if (n === 0) return 'нуль';
  const words: string[] = [];
  for (let scale = SCALES.length - 1; scale >= 0; scale--) {
    const value = Math.floor(n / 1000 ** scale) % 1000;
    if (value === 0) continue;
    words.push(...triad(value, SCALES[scale].feminine));
    if (scale > 0) words.push(plural(value, SCALES[scale].forms));
  }
  return words.join(' ');
}

export function amountInWords(amount: number): string {
  const kopecks = Math.round(amount * 100);
  const hryvnias = Math.floor(kopecks / 100);
  const rest = kopecks % 100;
  return (
    `${integerInWords(hryvnias)} ${plural(hryvnias, ['гривня', 'гривні', 'гривень'])} ` +
    `${String(rest).padStart(2, '0')} ${plural(rest, ['копійка', 'копійки', 'копійок'])}`
  );
}
