import { VERSION } from "./core.js?v=20261031-store-orders-r35";
const BASE = `${typeof location!=="undefined"&&location.pathname.startsWith("/store-orders/guest/")?"/store-orders/guest":"/store-orders"}/vendor/${VERSION}/`;
export async function pagesFor(file) {
  if (file.size > 20000000) throw Error("每個檔案最多20MB，請分頁拍攝或壓縮");
  const type = file.type || (/\.heic$/i.test(file.name || "") ? "image/heic" : "");
  if (type === "application/pdf") {
    const pdfjs = await import(`${BASE}pdf/pdf.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${BASE}pdf/pdf.worker.mjs`;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true, cMapUrl: `${BASE}pdf/cmaps/`, cMapPacked: true, standardFontDataUrl: `${BASE}pdf/standard_fonts/` }).promise;
    if (pdf.numPages > 30) { await pdf.destroy(); throw Error("單一檔案最多30頁"); }
    const pages = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i), original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 2200 / Math.max(original.width, original.height)) });
        const canvas = document.createElement("canvas"); canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        pages.push(await new Promise(resolve => canvas.toBlob(resolve, "image/png"))); page.cleanup(); canvas.width = canvas.height = 0;
      }
    } finally { await pdf.destroy(); }
    return pages;
  }
  if (["image/heic", "image/heif"].includes(type)) {
    try { const {heicTo}=await import(`${BASE}heic/heic-to.min.js`); const converted = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 }); return Array.isArray(converted) ? converted : [converted]; }
    catch { throw Error("此HEIC照片無法轉換，請在手機改用JPEG或重新拍照"); }
  }
  if (!["image/jpeg", "image/png"].includes(type)) throw Error("請選JPEG、PNG、HEIC或PDF；不支援的格式請轉檔");
  try { const image = await createImageBitmap(file); if (image.width * image.height > 40000000) throw Error(); image.close(); }
  catch { throw Error("照片無法開啟或尺寸過大，請重新拍照或縮小"); }
  return [file];
}
export async function recognize(pages, progress = () => {}) {
  if (!globalThis.Tesseract) throw Error("本機辨識元件未載入，可先對照原圖人工輸入");
  const worker = await Tesseract.createWorker("chi_tra+eng", 1, { workerPath: `${BASE}ocr/worker.min.js`, corePath: `${BASE}ocr/tesseract-core-lstm.wasm.js`, langPath: `${BASE}ocr`, gzip: false, workerBlobURL: false, cacheMethod: "none", logger: m => progress(m.status === "recognizing text" ? `本機辨識 ${Math.round(m.progress * 100)}%` : "準備本機辨識元件…") });
  try { const results = []; for (let i=0;i<pages.length;i++) { progress(`辨識第${i+1}/${pages.length}頁`); results.push((await worker.recognize(pages[i])).data.text); } return results.join("\n\n"); }
  finally { await worker.terminate(); }
}
