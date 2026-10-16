// Original MathType 7.8 unit table at 0x93d400 and getter 0x657490.
// Values are integer 1/32 pt (or percent*32 before reference scaling).
// This covers ordinary finite inputs; overflowing legacy values are rejected.
export function nativeDimension32(d,reference32=384,{relative=true}={}){
 const units={in:[11,2304],cm:[9,907],pt:[5,32],pc:[8,384],'%':[5,32],percent:[5,32]},unit=typeof d?.unit==='number'?['in','cm','pt','pc','%'][d.unit]:d?.unit;
 const table=units[unit],match=/^(-?)(\d*)(?:\.(\d*))?$/.exec(String(d?.value));
 if(!table||!match||!(match[2]||match[3]))throw Error('Unsupported native dimension');
 const whole=BigInt((match[2]||'0').slice(0,6)),fraction=(match[3]||'').slice(0,6),factor=1n<<BigInt(table[0]);
 const fixed=whole*factor+(fraction?BigInt(fraction)*factor/10n**BigInt(fraction.length):0n);
 let value=BigInt(table[1])*fixed/factor;if(match[1])value=-value;
 if(value < -32767n||value>32767n)throw Error('Native dimension exceeds signed layout range');
 if(unit==='%'||unit==='percent'){
  if(relative){if(!Number.isInteger(reference32)||reference32<1||reference32>32767)throw Error('Invalid native reference size');value=value*BigInt(reference32)/3200n;}
 }
 return Number(value);
}
