(function (global) {
  "use strict";

  const MAX_SALES_SHEET_BYTES = 100 * 1024 * 1024;
  const TARGET_SPLIT_BYTES = 80 * 1024 * 1024;

  function findEndOfCentralDirectory(bytes) {
    for (let index = bytes.length - 22; index >= 0; index -= 1) {
      if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x05 && bytes[index + 3] === 0x06) return index;
    }
    return -1;
  }

  function zip64UncompressedBytes(bytes, offset, length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = offset + length;
    while (offset + 4 <= end) {
      const headerId = view.getUint16(offset, true);
      const dataSize = view.getUint16(offset + 2, true);
      const dataOffset = offset + 4;
      if (headerId === 0x0001 && dataSize >= 8 && dataOffset + 8 <= end) {
        const value = view.getBigUint64(dataOffset, true);
        return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
      }
      offset = dataOffset + dataSize;
    }
    return null;
  }

  async function inspect(file) {
    if (!file || !/\.xlsx$/i.test(file.name || "")) return null;
    const tailOffset = Math.max(0, file.size - 66_000);
    const tail = new Uint8Array(await file.slice(tailOffset).arrayBuffer());
    const eocdIndex = findEndOfCentralDirectory(tail);
    if (eocdIndex < 0) return null;
    const eocd = new DataView(tail.buffer, tail.byteOffset + eocdIndex);
    const centralDirectorySize = eocd.getUint32(12, true);
    const centralDirectoryOffset = eocd.getUint32(16, true);
    if (centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) return null;

    const bytes = new Uint8Array(await file.slice(centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder("utf-8");
    const worksheets = [];
    let offset = 0;
    while (offset + 46 <= bytes.length && view.getUint32(offset, true) === 0x02014b50) {
      let uncompressedBytes = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      if (uncompressedBytes === 0xffffffff) {
        uncompressedBytes = zip64UncompressedBytes(bytes, offset + 46 + nameLength, extraLength);
      }
      if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name) && Number.isFinite(uncompressedBytes)) worksheets.push({ name, uncompressedBytes });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    if (!worksheets.length) return null;
    return {
      worksheets,
      largestWorksheetBytes: Math.max(...worksheets.map((entry) => entry.uncompressedBytes)),
      totalWorksheetBytes: worksheets.reduce((sum, entry) => sum + entry.uncompressedBytes, 0)
    };
  }

  async function assertSalesWorkbookSize(file) {
    const footprint = await inspect(file);
    if (!footprint || footprint.largestWorksheetBytes <= MAX_SALES_SHEET_BYTES) return footprint;
    const expandedMb = Math.ceil(footprint.largestWorksheetBytes / 1024 / 1024);
    const parts = Math.max(2, Math.ceil(footprint.largestWorksheetBytes / TARGET_SPLIT_BYTES));
    throw new Error(`「${file.name}」壓縮後雖只有${Math.ceil(file.size / 1024 / 1024)}MB，但工作表展開約${expandedMb}MB，瀏覽器無法安全一次讀取。請依日期或列數拆成至少${parts}份.xlsx後多選匯入；欄位不必刪除，系統會自動合併計算。`);
  }

  global.StoreTransferXlsxPreflight = { inspect, assertSalesWorkbookSize, MAX_SALES_SHEET_BYTES };
})(typeof globalThis !== "undefined" ? globalThis : window);
