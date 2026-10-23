import * as pdfjsLib from "./vendor/pdfjs-6.4.299/pdf.min.mjs";

const MAX_PDF_PAGES = 8;
const MAX_EXTRACTED_CHARS = 30000;
const MIN_USABLE_TEXT = 80;

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs-6.4.299/pdf.worker.min.mjs", import.meta.url).href;

function compactText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);
}

function pageBlock(pageNumber, text) {
  const clean = compactText(text);
  return clean ? `=== 第 ${pageNumber} 頁 ===\n${clean}` : "";
}

async function createOcrWorker(onProgress) {
  const module = await import("./vendor/tesseract-7.0.0/tesseract.esm.min.js");
  const { createWorker } = module.default || {};
  if (typeof createWorker !== "function") throw new Error("本機 OCR 元件未正確載入。");
  return createWorker("chi_tra", 1, {
    workerPath: new URL("./vendor/tesseract-7.0.0/worker.min.js", import.meta.url).href,
    corePath: new URL("./vendor/tesseract-7.0.0/core", import.meta.url).href,
    langPath: new URL("./vendor/tesseract-7.0.0/lang", import.meta.url).href,
    logger(message) {
      if (message?.status === "recognizing text" && Number.isFinite(message.progress)) {
        onProgress?.({ stage: "ocr", progress: Math.round(message.progress * 100) });
      }
    }
  });
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("無法建立 OCR 圖像。")), "image/png"));
}

async function ocrPdfPages(pdf, pageCount, onProgress) {
  const worker = await createOcrWorker(onProgress);
  const blocks = [];
  try {
    for (let index = 1; index <= pageCount; index += 1) {
      onProgress?.({ stage: "ocr-page", page: index, pageCount });
      const page = await pdf.getPage(index);
      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("瀏覽器無法建立工單辨識畫布。");
      await page.render({ canvasContext: context, viewport }).promise;
      const result = await worker.recognize(await canvasBlob(canvas));
      blocks.push(pageBlock(index, result?.data?.text));
      canvas.width = 1;
      canvas.height = 1;
    }
  } finally {
    await worker.terminate();
  }
  return compactText(blocks.filter(Boolean).join("\n\n"));
}

async function extractPdf(file, onProgress) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({
    data,
    cMapUrl: new URL("./vendor/pdfjs-6.4.299/cmaps/", import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("./vendor/pdfjs-6.4.299/standard_fonts/", import.meta.url).href,
    wasmUrl: new URL("./vendor/pdfjs-6.4.299/wasm/", import.meta.url).href,
    isEvalSupported: false
  }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const blocks = [];
  for (let index = 1; index <= pageCount; index += 1) {
    onProgress?.({ stage: "pdf-text", page: index, pageCount });
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const text = content.items.map((item) => `${item.str || ""}${item.hasEOL ? "\n" : " "}`).join("");
    blocks.push(pageBlock(index, text));
  }
  const extracted = compactText(blocks.filter(Boolean).join("\n\n"));
  if (extracted.replace(/=== 第 \d+ 頁 ===/g, "").trim().length >= MIN_USABLE_TEXT) {
    return { text: extracted, method: "pdf-text", pageCount, totalPages: pdf.numPages, truncatedPages: pdf.numPages > pageCount };
  }
  const ocrText = await ocrPdfPages(pdf, pageCount, onProgress);
  return { text: ocrText, method: "pdf-ocr", pageCount, totalPages: pdf.numPages, truncatedPages: pdf.numPages > pageCount };
}

async function extractImage(file, onProgress) {
  const worker = await createOcrWorker(onProgress);
  try {
    const result = await worker.recognize(file);
    return { text: compactText(pageBlock(1, result?.data?.text)), method: "image-ocr", pageCount: 1, totalPages: 1, truncatedPages: false };
  } finally {
    await worker.terminate();
  }
}

export async function extractTextLocally(file, onProgress) {
  if (!(file instanceof Blob)) throw new Error("請重新選擇工單檔案。");
  onProgress?.({ stage: "start" });
  const result = file.type === "application/pdf" ? await extractPdf(file, onProgress) : await extractImage(file, onProgress);
  if (!result.text || result.text.length < 20) throw new Error("未辨識到足夠文字，請改用更清晰的工單或人工填寫。");
  return result;
}
