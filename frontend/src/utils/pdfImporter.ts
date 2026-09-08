export interface RenderedPdfPage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

const MAX_PDF_PAGES = 30;
const MAX_RENDER_EDGE = 1600;

export async function renderPdfPages(file: File): Promise<RenderedPdfPage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await loadingTask.promise;
  if (document.numPages > MAX_PDF_PAGES) {
    await document.destroy();
    throw new Error(`PDFは${MAX_PDF_PAGES}ページ以内にしてください。`);
  }

  const pages: RenderedPdfPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, MAX_RENDER_EDGE / Math.max(baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("PDFページの描画領域を作成できませんでした。");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push({
        pageNumber,
        dataUrl: canvas.toDataURL("image/jpeg", 0.92),
        width: canvas.width,
        height: canvas.height,
        name: `${file.name} - ${pageNumber}ページ`,
      });
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  return pages;
}
