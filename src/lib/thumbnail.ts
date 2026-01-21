import * as pdfjsLib from "pdfjs-dist";

// Set up the worker - use the bundled worker from pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export interface ThumbnailResult {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Generate a thumbnail from a PDF file or blob.
 * Renders the first page to a canvas and returns it as a PNG blob.
 */
export async function generateThumbnailFromPdf(
  pdfSource: File | Blob | ArrayBuffer,
  options: { maxWidth?: number; maxHeight?: number } = {}
): Promise<ThumbnailResult> {
  const { maxWidth = 800, maxHeight = 1200 } = options;

  // Convert to ArrayBuffer if needed
  let arrayBuffer: ArrayBuffer;
  if (pdfSource instanceof ArrayBuffer) {
    arrayBuffer = pdfSource;
  } else {
    arrayBuffer = await pdfSource.arrayBuffer();
  }

  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  // Get the first page
  const page = await pdf.getPage(1);

  // Calculate scale to fit within max dimensions while maintaining aspect ratio
  const viewport = page.getViewport({ scale: 1 });
  const scaleX = maxWidth / viewport.width;
  const scaleY = maxHeight / viewport.height;
  const scale = Math.min(scaleX, scaleY, 3); // Cap at 3x for quality

  const scaledViewport = page.getViewport({ scale });

  // Create a canvas to render the page
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get canvas 2D context");
  }

  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;

  // Render the page to the canvas
  await page.render({
    canvasContext: context,
    viewport: scaledViewport,
  }).promise;

  // Convert canvas to blob
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create thumbnail blob"));
        }
      },
      "image/png",
      0.9
    );
  });

  // Cleanup
  pdf.destroy();

  return {
    blob,
    width: canvas.width,
    height: canvas.height,
  };
}
