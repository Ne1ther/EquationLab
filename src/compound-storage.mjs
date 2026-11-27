import CFB from 'cfb';

const endOfChain = 0xfffffffe;

export function writeCompoundStorage(storage) {
  const file = Buffer.from(CFB.write(storage, {type:'buffer'}));
  const sectorSize = 2 ** file.readUInt16LE(30);
  const miniSectorSize = 2 ** file.readUInt16LE(32);
  const entriesPerSector = sectorSize / 4;
  const sectorOffset = id => (id + 1) * sectorSize;
  const fatCount = file.readUInt32LE(44);
  const fatSectors = [];
  for (let i = 0; i < Math.min(fatCount, 109); i++) {
    fatSectors.push(file.readUInt32LE(76 + i * 4));
  }
  let difat = file.readUInt32LE(68);
  while (fatSectors.length < fatCount) {
    const offset = sectorOffset(difat);
    for (let i = 0; i < entriesPerSector - 1 && fatSectors.length < fatCount; i++) {
      fatSectors.push(file.readUInt32LE(offset + i * 4));
    }
    difat = file.readUInt32LE(offset + sectorSize - 4);
  }
  const fatEntryOffset = id => sectorOffset(fatSectors[Math.floor(id / entriesPerSector)]) + id % entriesPerSector * 4;

  // cfb 1.2.2 pads both allocation tables with ENDOFCHAIN. MS-CFB
  // requires FREESECT for entries beyond the file and mini stream ends.
  // Change only the padding. The library still allocates all stream chains.
  const fileSectors = file.length / sectorSize - 1;
  for (let id = fileSectors; id < fatCount * entriesPerSector; id++) {
    file.writeUInt32LE(0xffffffff, fatEntryOffset(id));
  }

  const firstDirectorySector = file.readUInt32LE(48);
  const rootEntry = sectorOffset(firstDirectorySector);
  let miniSectors = Math.ceil(file.readUInt32LE(rootEntry + 120) / miniSectorSize);
  let miniFat = file.readUInt32LE(60);
  const miniFatCount = file.readUInt32LE(64);
  for (let i = 0; i < miniFatCount; i++) {
    const offset = sectorOffset(miniFat);
    const used = Math.min(entriesPerSector, miniSectors);
    file.fill(0xff, offset + used * 4, offset + sectorSize);
    miniSectors -= used;
    miniFat = file.readUInt32LE(fatEntryOffset(miniFat));
  }
  // The writer may leave a reused start sector on an empty stream. Its
  // directory entry still exists, but it has no chain to follow.
  for (let id = firstDirectorySector; id !== endOfChain; id = file.readUInt32LE(fatEntryOffset(id))) {
    const start = sectorOffset(id);
    for (let entry = start; entry < start + sectorSize; entry += 128) {
      if (file[entry + 66] === 2 && file.readBigUInt64LE(entry + 120) === 0n) {
        file.writeUInt32LE(endOfChain, entry + 116);
      }
    }
  }
  return file;
}
