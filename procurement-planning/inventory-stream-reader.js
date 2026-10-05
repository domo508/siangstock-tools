(function (global) {
  "use strict";

  const ZIP_EOCD = 0x06054b50;
  const ZIP_CENTRAL = 0x02014b50;
  const ZIP_LOCAL = 0x04034b50;
  const MAX_DIRECTORY_TAIL = 65557;
  const MAX_SHARED_STRINGS_BYTES = 64 * 1024 * 1024;
  const decoder = new TextDecoder("utf-8");

  function uint32(view, offset) { return view.getUint32(offset, true); }
  function uint16(view, offset) { return view.getUint16(offset, true); }
  function uint64(view, offset) {
    const value = Number(view.getBigUint64(offset, true));
    if (!Number.isSafeInteger(value)) throw new Error("庫存檔索引超過瀏覽器可安全處理的大小。");
    return value;
  }

  async function inspectZip(file) {
    const tailStart = Math.max(0, file.size - MAX_DIRECTORY_TAIL);
    const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
    const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let eocd = -1;
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (uint32(tailView, offset) === ZIP_EOCD) { eocd = offset; break; }
    }
    if (eocd < 0) throw new Error("庫存檔不是完整的Excel壓縮檔，找不到檔案索引。");
    const directorySize = uint32(tailView, eocd + 12);
    const directoryOffset = uint32(tailView, eocd + 16);
    if (directoryOffset === 0xffffffff || directorySize === 0xffffffff) throw new Error("庫存檔使用目前不支援的超大型ZIP64格式。");
    const directory = new Uint8Array(await file.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer());
    const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
    const entries = [];
    let offset = 0;
    while (offset + 46 <= directory.length && uint32(view, offset) === ZIP_CENTRAL) {
      const nameLength = uint16(view, offset + 28);
      const extraLength = uint16(view, offset + 30);
      const commentLength = uint16(view, offset + 32);
      const name = decoder.decode(directory.subarray(offset + 46, offset + 46 + nameLength));
      let compressedSize = uint32(view, offset + 20);
      let uncompressedSize = uint32(view, offset + 24);
      let localHeaderOffset = uint32(view, offset + 42);
      let extraOffset = offset + 46 + nameLength;
      const extraEnd = extraOffset + extraLength;
      while (extraOffset + 4 <= extraEnd) {
        const extraId = uint16(view, extraOffset);
        const extraSize = uint16(view, extraOffset + 2);
        let valueOffset = extraOffset + 4;
        if (extraId === 0x0001) {
          if (uncompressedSize === 0xffffffff) { uncompressedSize = uint64(view, valueOffset); valueOffset += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = uint64(view, valueOffset); valueOffset += 8; }
          if (localHeaderOffset === 0xffffffff) localHeaderOffset = uint64(view, valueOffset);
        }
        extraOffset += 4 + extraSize;
      }
      entries.push({
        name,
        compressionMethod: uint16(view, offset + 10),
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function openEntryStream(file, entry) {
    const headerBytes = new Uint8Array(await file.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer());
    const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
    if (headerBytes.length < 30 || uint32(view, 0) !== ZIP_LOCAL) throw new Error(`庫存檔內的${entry.name}索引不完整。`);
    const dataOffset = entry.localHeaderOffset + 30 + uint16(view, 26) + uint16(view, 28);
    const compressed = file.slice(dataOffset, dataOffset + entry.compressedSize).stream();
    if (entry.compressionMethod === 0) return compressed;
    if (entry.compressionMethod !== 8) throw new Error(`庫存檔使用不支援的壓縮方式（${entry.compressionMethod}）。`);
    if (typeof DecompressionStream !== "function") throw new Error("目前瀏覽器不支援大型庫存串流解壓縮，請更新Chrome或Edge後再試。");
    return compressed.pipeThrough(new DecompressionStream("deflate-raw"));
  }

  function decodeXml(value) {
    return String(value || "")
      .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .replace(/_x([0-9a-f]{4})_/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  function columnIndex(reference) {
    const letters = String(reference || "").match(/^([A-Z]+)/i)?.[1]?.toUpperCase() || "";
    let value = 0;
    for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
    return Math.max(0, value - 1);
  }

  function textNodes(xml) {
    let value = "";
    for (const match of String(xml || "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) value += decodeXml(match[1]);
    return value;
  }

  function parseRow(xml, sharedStrings) {
    const row = [];
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    for (const match of xml.matchAll(cellPattern)) {
      const attributes = match[1] || "";
      const body = match[2] || "";
      const reference = attributes.match(/\br="([A-Z]+\d+)"/i)?.[1] || "";
      if (!reference) continue;
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] || "";
      let value = "";
      if (type === "inlineStr") value = textNodes(body);
      else {
        const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] || "";
        value = type === "s" ? (sharedStrings[Number(raw)] ?? "") : decodeXml(raw);
      }
      row[columnIndex(reference)] = value;
    }
    return row;
  }

  async function readSharedStrings(file, entry) {
    if (!entry) return [];
    if (entry.uncompressedSize > MAX_SHARED_STRINGS_BYTES) throw new Error("庫存檔的共用文字索引異常過大，無法安全讀取。");
    const text = await new Response(await openEntryStream(file, entry)).text();
    return [...text.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => textNodes(match[1]));
  }

  async function forEachWorksheetRow(file, entry, sharedStrings, callback) {
    const reader = (await openEntryStream(file, entry)).getReader();
    const textDecoder = new TextDecoder("utf-8");
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? textDecoder.decode() : textDecoder.decode(value, { stream: true });
      while (true) {
        const start = buffer.indexOf("<row");
        if (start < 0) { buffer = buffer.slice(-16); break; }
        const end = buffer.indexOf("</row>", start);
        if (end < 0) { if (start > 0) buffer = buffer.slice(start); break; }
        callback(parseRow(buffer.slice(start, end + 6), sharedStrings));
        buffer = buffer.slice(end + 6);
      }
      if (done) break;
    }
  }

  async function readInventory(file, core, XLSX, entries = null) {
    const zipEntries = entries || await inspectZip(file);
    const worksheet = zipEntries.find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name));
    if (!worksheet) throw new Error("庫存檔找不到可讀取的工作表。");
    const sharedStrings = await readSharedStrings(file, zipEntries.find((entry) => entry.name.toLowerCase() === "xl/sharedstrings.xml"));
    const buffered = [];
    let selected = null;
    let compactRows = null;
    const canonicalHeaders = ["店倉編號", "店倉名稱", "ERP品號", "品名", "數量", "庫存成本"];
    const fields = ["warehouseCode", "warehouseName", "sku", "name", "quantity", "inventoryCost"];
    const append = (row) => compactRows.push(fields.map((field) => {
      const column = selected.mapping[field];
      return column == null ? "" : (row[column] ?? "");
    }));
    const initialize = () => {
      selected = core.identifyInventoryHeader(buffered);
      if (!selected.validation.valid) throw new Error(`庫存檔缺少：${selected.validation.missing.join("、")}`);
      compactRows = Array.from({ length: selected.headerRowIndex + 1 }, () => []);
      compactRows[selected.headerRowIndex] = canonicalHeaders;
      for (let index = selected.headerRowIndex + 1; index < buffered.length; index += 1) append(buffered[index]);
    };
    await forEachWorksheetRow(file, worksheet, sharedStrings, (row) => {
      if (!selected) {
        buffered.push(row);
        if (buffered.length === 35) initialize();
      } else append(row);
    });
    if (!selected) initialize();
    compactRows["!ref"] = `A1:F${Math.max(1, compactRows.length)}`;
    const workbook = { SheetNames: ["串流庫存"], Sheets: { "串流庫存": compactRows } };
    const inventory = core.parseInventoryWorkbook(workbook, XLSX, { fileName: file.name || "本次庫存" });
    inventory.diagnostics = { ...inventory.diagnostics, readerMode: "stream", worksheetBytes: worksheet.uncompressedSize };
    return inventory;
  }

  global.ProcurementInventoryStreamReader = Object.freeze({ inspectZip, readInventory });
})(typeof self !== "undefined" ? self : globalThis);
