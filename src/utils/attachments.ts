import type { ChatAttachment } from '../types';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_TEXT_CHARS = 80_000;

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'c',
  'cpp',
  'go',
  'rs',
  'sql',
  'sh',
  'log',
]);

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Could not read text from "${file.name}".`));
    reader.readAsText(file);
  });
}

export async function processUploadedFiles(files: FileList | File[]): Promise<{
  attachments: ChatAttachment[];
  errors: string[];
}> {
  const list = Array.from(files).slice(0, 4);
  const attachments: ChatAttachment[] = [];
  const errors: string[] = [];

  for (const file of list) {
    if (file.size > MAX_FILE_BYTES) {
      errors.push(`"${file.name}" exceeds 5 MB limit.`);
      continue;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isImage = file.type.startsWith('image/');
    const isTextLike =
      file.type.startsWith('text/') ||
      file.type === 'application/json' ||
      file.type === 'application/xml' ||
      TEXT_EXTENSIONS.has(ext);
    const isSpreadsheet =
      ext === 'xlsx' ||
      ext === 'xls' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';
    const isPdf = file.type === 'application/pdf' || ext === 'pdf';

    try {
      const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      if (isImage) {
        const dataUrl = await readFileAsDataUrl(file);
        const commaIdx = dataUrl.indexOf(',');
        const dataBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
        attachments.push({
          id,
          name: file.name,
          mimeType: file.type || 'image/png',
          kind: 'image',
          size: file.size,
          dataBase64,
          previewUrl: dataUrl,
        });
        continue;
      }

      if (isSpreadsheet) {
        const buffer = await file.arrayBuffer();
        const { default: ExcelJS } = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.worksheets[0];
        const lines: string[] = [];
        if (sheet) {
          sheet.eachRow({ includeEmpty: false }, (row) => {
            if (lines.length >= 500) return;
            const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
            const escaped = vals.map((cell) => {
              const raw =
                cell && typeof cell === 'object' && 'text' in cell
                  ? String((cell as { text: unknown }).text ?? '')
                  : String(cell ?? '');
              return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
            });
            lines.push(escaped.join(','));
          });
        }
        const csvText = lines.join('\n').slice(0, MAX_TEXT_CHARS);
        attachments.push({
          id,
          name: file.name,
          mimeType: 'text/csv',
          kind: 'file',
          size: file.size,
          textContent: csvText || `Empty spreadsheet (${file.name})`,
        });
        continue;
      }

      if (isTextLike) {
        const rawText = await readFileAsText(file);
        const clipped =
          rawText.length > MAX_TEXT_CHARS
            ? `${rawText.slice(0, MAX_TEXT_CHARS)}\n\n[Truncated after ${MAX_TEXT_CHARS} characters]`
            : rawText;
        attachments.push({
          id,
          name: file.name,
          mimeType: file.type || 'text/plain',
          kind: 'file',
          size: file.size,
          textContent: clipped,
        });
        continue;
      }

      if (isPdf) {
        const dataUrl = await readFileAsDataUrl(file);
        const commaIdx = dataUrl.indexOf(',');
        const dataBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
        attachments.push({
          id,
          name: file.name,
          mimeType: 'application/pdf',
          kind: 'file',
          size: file.size,
          dataBase64,
        });
        continue;
      }

      // Generic binary/document fallback
      const dataUrl = await readFileAsDataUrl(file);
      const commaIdx = dataUrl.indexOf(',');
      const dataBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
      attachments.push({
        id,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        kind: 'file',
        size: file.size,
        dataBase64,
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `Failed to process "${file.name}".`);
    }
  }

  return { attachments, errors };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
