/** 批注数据模型与「发给 AI」的消息格式化（模板与 Design 交互稿 v1 一致） */

export interface Annotation {
  id: string;
  path: string;
  fileSha1: string | null;
  /** 1-based 行号 */
  from: number;
  /** 1-based 行号 */
  to: number;
  quote: string;
  text: string;
  status: 'open' | 'resolved' | 'stale';
  createdAt: number;
  sentAt?: number;
  /** S2 分页/图片批注：整页或整张图，没有可引用的文字 */
  block?: AnnotationBlock;
  /** S3 分页文档文字层批注：1-based 页码，配合 quote 输出「第N页 【原文】…」 */
  page?: number;
}

export interface AnnotationBlock {
  /** 1-based 页序（图片固定为 1；xlsx 是 1-based sheet 序号） */
  page: number;
  /** 展示/发送用的标签，如「第2页」「工作表「数据」 A1:C6」「图片」 */
  label: string;
  sheet?: string;
  range?: string;
  /** 视频/音频时间码批注：跳转与卡片定位用的秒数 */
  at?: number;
  /** UI 选中态标记；块批注消息一律不带【原文】（Design 约定） */
  selected?: boolean;
}

export interface MessageOptions {
  relPath: string;
  version: number;
  annotations: readonly Annotation[];
  includePath: boolean;
  includeQuote: boolean;
}

export function trimQuote(quote: string, max = 300): string {
  const clean = quote.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

/** 批注消息是 markdown：路径/原文/意见里的反引号和换行必须转义，避免破坏模板 */
export function escapeMessageText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\r?\n/g, ' ');
}

/**
 * 生成发给 AI 的批注消息（S1 模板固定，改动需同步 Design 交互稿）。
 * 2026-11-18 复审补充：每条批注前带行号区间 L<start>-<end>，与批注卡口径一致。
 * 2026-11-20 S2 补充：整页/图片/工作表批注用 label，一律不输出【原文】。
 * 2026-11-20 S3 补充：分页文档文字层批注输出「第N页 【原文】"…"」，与行号批注同构。
 * 2026-11-20 xlsx DOM 表格补充：块批注（工作表/单元格/区域）一律不输出【原文】。
 */
export function buildAnnotationMessage(options: MessageOptions): string {
  const { relPath, version, annotations, includePath, includeQuote } = options;
  const lines: string[] = ['请按以下批注修改文件：', ''];
  if (includePath) lines.push(`文件：${escapeMessageText(relPath)}（v${version}）`);
  lines.push(`共 ${annotations.length} 条批注`, '');

  annotations.forEach((annotation, index) => {
    const text = escapeMessageText(annotation.text);
    if (annotation.block) {
      lines.push(`${index + 1}. ${escapeMessageText(annotation.block.label)} 【意见】${text}`);
    } else if (annotation.page !== undefined) {
      const pageLabel = `第${annotation.page}页`;
      const quote = escapeMessageText(annotation.quote);
      if (includeQuote && quote.trim()) {
        lines.push(`${index + 1}. ${pageLabel} 【原文】"${quote}"`);
        lines.push(`   【意见】${text}`);
      } else {
        lines.push(`${index + 1}. ${pageLabel} 【意见】${text}`);
      }
    } else {
      const range = `L${annotation.from}-${annotation.to}`;
      const quote = escapeMessageText(annotation.quote);
      if (includeQuote) {
        lines.push(`${index + 1}. ${range} 【原文】"${quote}"`);
        lines.push(`   【意见】${text}`);
      } else {
        lines.push(`${index + 1}. ${range} 【意见】${text}`);
      }
    }
    if (index < annotations.length - 1) lines.push('');
  });

  lines.push('', '要求：只改批注涉及的内容，其余保持不变；改完告诉我改了哪几处。');
  return lines.join('\n');
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

/** 文本行号裁剪：返回 1-based 行号 */
export function lineCount(content: string): number {
  if (!content) return 0;
  return content.split('\n').length;
}
