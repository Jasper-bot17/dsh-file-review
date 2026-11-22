/**
 * pdfjs-dist 只按需动态加载 legacy ESM 构建；官方包没有为这个深路径导出类型，
 * 这里按实际用到的最小面声明，避免把 35.9 MB 的包类型拖进 Host 编译。
 */
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export interface PdfTextItem {
    str: string;
    transform: number[];
    width: number;
    height?: number;
  }

  export interface PdfViewport {
    width: number;
    height: number;
    transform: number[];
  }

  export interface PdfPageProxy {
    getViewport(params: { scale: number }): PdfViewport;
    getTextContent(): Promise<{ items: PdfTextItem[] }>;
    cleanup(): void;
  }

  export interface PdfDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPageProxy>;
  }

  export interface PdfLoadingTask {
    promise: Promise<PdfDocumentProxy>;
    destroy(): Promise<void>;
  }

  export function getDocument(options: Record<string, unknown>): PdfLoadingTask;
  export const Util: { transform(first: number[], second: number[]): number[] };
}
