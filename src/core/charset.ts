const printable = Array.from({ length: 95 }, (_, k) => String.fromCharCode(32 + k)).join('');

// Index 0 must stay the blank cell: the presenter treats glyph 0 as "background only".
export const CHARSET = printable + '░▒▓█▀▄';

const lookup = new Map<string, number>();
for (let k = 0; k < CHARSET.length; k++) lookup.set(CHARSET[k], k);

export function glyph(ch: string): number {
  const v = lookup.get(ch);
  if (v === undefined) throw new Error(`glyph not in charset: ${ch}`);
  return v;
}
