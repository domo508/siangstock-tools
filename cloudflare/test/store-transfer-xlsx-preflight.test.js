import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadPreflight() {
  const context = { Blob, TextDecoder };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.resolve("../store-transfer/xlsx-preflight.js"), "utf8"), context);
  return context.StoreTransferXlsxPreflight;
}

function workbookBlob(uncompressedBytes, name = "近12週銷售.xlsx") {
  const entryName = new TextEncoder().encode("xl/worksheets/sheet1.xml");
  const central = new Uint8Array(46 + entryName.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint32(24, uncompressedBytes, true);
  centralView.setUint16(28, entryName.length, true);
  central.set(entryName, 46);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, 1, true);
  eocdView.setUint16(10, 1, true);
  eocdView.setUint32(12, central.length, true);
  eocdView.setUint32(16, 0, true);
  const blob = new Blob([central, eocd]);
  Object.defineProperty(blob, "name", { value: name });
  return blob;
}

function zip64WorkbookBlob(uncompressedBytes) {
  const entryName = new TextEncoder().encode("xl/worksheets/sheet1.xml");
  const extra = new Uint8Array(12);
  const extraView = new DataView(extra.buffer);
  extraView.setUint16(0, 0x0001, true);
  extraView.setUint16(2, 8, true);
  extraView.setBigUint64(4, BigInt(uncompressedBytes), true);
  const central = new Uint8Array(46 + entryName.length + extra.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint32(24, 0xffffffff, true);
  centralView.setUint16(28, entryName.length, true);
  centralView.setUint16(30, extra.length, true);
  central.set(entryName, 46);
  central.set(extra, 46 + entryName.length);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, 1, true);
  eocdView.setUint16(10, 1, true);
  eocdView.setUint32(12, central.length, true);
  eocdView.setUint32(16, 0, true);
  const blob = new Blob([central, eocd]);
  Object.defineProperty(blob, "name", { value: "ZIP64銷售.xlsx" });
  return blob;
}

describe("store transfer xlsx preflight", () => {
  it("reads the worksheet expanded size from the ZIP central directory", async () => {
    const preflight = loadPreflight();
    const footprint = await preflight.inspect(workbookBlob(236_000_000));
    expect(footprint.largestWorksheetBytes).toBe(236_000_000);
  });

  it("reads ZIP64 worksheet sizes used by ERP exports", async () => {
    const preflight = loadPreflight();
    const footprint = await preflight.inspect(zip64WorkbookBlob(235_921_218));
    expect(footprint.largestWorksheetBytes).toBe(235_921_218);
  });

  it("stops an oversized sales workbook with an actionable split instruction", async () => {
    const preflight = loadPreflight();
    await expect(preflight.assertSalesWorkbookSize(workbookBlob(236_000_000))).rejects.toThrow(/至少3份.*欄位不必刪除.*自動合併/);
  });

  it("allows a worksheet below the browser-safe threshold", async () => {
    const preflight = loadPreflight();
    await expect(preflight.assertSalesWorkbookSize(workbookBlob(50_000_000))).resolves.toBeTruthy();
  });
});
