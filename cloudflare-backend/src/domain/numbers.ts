/** Fixed decimal formatting with IEEE-754 ties-to-even; preserves the output contract. */
export function pythonFixed(value:number,digits:number):string {
  if(!Number.isFinite(value)||value<0)throw new Error('Expected a finite non-negative value');
  const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,value);
  const bits=view.getBigUint64(0);const exponent=Number((bits>>52n)&2047n);
  let numerator=bits&((1n<<52n)-1n);if(exponent)numerator|=1n<<52n;
  const power=(exponent||1)-1023-52;numerator*=10n**BigInt(digits);
  let denominator=1n;if(power>=0)numerator<<=BigInt(power);else denominator<<=BigInt(-power);
  let rounded=numerator/denominator;const remainder=numerator%denominator;
  if(remainder*2n>denominator||(remainder*2n===denominator&&rounded%2n===1n))rounded++;
  const text=rounded.toString().padStart(digits+1,'0');return digits?text.slice(0,-digits)+'.'+text.slice(-digits):text;
}
