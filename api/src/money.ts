// SAR-only pilot arithmetic: amounts are validated and summed as integer halalas.
// Real FX, 3-decimal currencies and different VAT rounding regimes are out of scope.
export function parseHalalas(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('Amount must be a positive decimal string with at most 2 fraction digits');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function formatHalalas(value: bigint): string {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
export type InputJournalLine = { accountId: string; debit: string; credit: string };
export function validateBalancedLines(lines: InputJournalLine[]): { debit: string; credit: string } {
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 200) throw new Error('A journal needs 2–200 lines');
  let d = 0n, c = 0n;
  for (const line of lines) {
    const ld = parseHalalas(line.debit), lc = parseHalalas(line.credit);
    if ((ld > 0n && lc > 0n) || (ld === 0n && lc === 0n)) throw new Error('Each line must be exclusively debit or credit');
    d += ld; c += lc;
  }
  if (d !== c || d <= 0n) throw new Error('Debit and credit totals must match and be nonzero');
  return { debit: formatHalalas(d), credit: formatHalalas(c) };
}

// Demo tax model: exclusive VAT; per-line HALF_UP rounding to halala.
// NOT a substitute for ZATCA policy handling, discounts, exemption, credit notes, or rounding validations.
export function calculateLine(quantity:number,unitPrice:string,taxRate:0|15){
  if(!Number.isInteger(quantity)||quantity<1||quantity>100000)throw new Error('Invalid quantity');
  if(taxRate!==0&&taxRate!==15)throw new Error('Unsupported demo VAT rate');
  const unit=parseHalalas(unitPrice);
  const net=unit*BigInt(quantity);
  const tax=(net*BigInt(taxRate)+50n)/100n;
  return {net:formatHalalas(net),tax:formatHalalas(tax),gross:formatHalalas(net+tax)};
}
export function paymentValid(total:string,alreadyPaid:string,add:string){
  const t=parseHalalas(total),p=parseHalalas(alreadyPaid),a=parseHalalas(add);
  if(a<=0n||a>t-p)return false;
  return true;
}

