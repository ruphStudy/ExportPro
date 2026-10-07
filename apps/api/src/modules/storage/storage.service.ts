import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
];
export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
];
export const MAX_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const UPLOAD_ROOT = join(process.cwd(), 'uploads');
/** Not served by express.static — for files that must never be publicly reachable. */
const PRIVATE_ROOT = join(process.cwd(), 'private-uploads');
export const MAX_DATA_IMPORT_BYTES = 10 * 1024 * 1024; // 10MB

/** CRM lead attachments: commercial documents, images, spreadsheets, text. */
export const LEAD_ATTACHMENT_EXTENSIONS: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    '.docx',
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    '.xlsx',
  ],
};
export const MAX_LEAD_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB

/** Buyer inquiry / RFQ attachments: lead types plus legacy Excel and saved emails. No executables. */
export const INQUIRY_ATTACHMENT_EXTENSIONS: Record<string, string[]> = {
  ...LEAD_ATTACHMENT_EXTENSIONS,
  'application/vnd.ms-excel': ['.xls'],
  'message/rfc822': ['.eml'],
};
export const MAX_INQUIRY_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB
const PRIVATE_KEY_RE = /^private:([a-z-]+)\/([0-9a-f-]{36}\.[a-z0-9]+)$/;
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
const ALLOWED_EXTENSIONS_BY_MIME: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};

/**
 * Local-disk storage adapter. Files land in apps/api/uploads/<folder>/
 * and are served statically from /uploads (see main.ts). This is a
 * development/single-instance adapter — swapping to S3/GCS later means
 * replacing this class's methods, not touching any caller, since
 * callers only ever see `{ url }` back.
 */
@Injectable()
export class StorageService {
  private async save(
    folder: string,
    file: Express.Multer.File,
    allowedMimeTypes: string[],
    maxSizeBytes: number,
  ): Promise<{ url: string; path: string }> {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}.`);
    }
    if (file.size > maxSizeBytes) {
      throw new BadRequestException(
        `File must be ${Math.round(maxSizeBytes / (1024 * 1024))}MB or smaller.`,
      );
    }
    // Mime type alone can be spoofed by the client; cross-check the
    // extension to make this harder than editing a Content-Type header.
    const extension = extname(file.originalname).toLowerCase();
    const allowedExtensions = ALLOWED_EXTENSIONS_BY_MIME[file.mimetype] ?? [];
    if (extension && !allowedExtensions.includes(extension)) {
      throw new BadRequestException(
        'File extension does not match its content type.',
      );
    }

    const dir = join(UPLOAD_ROOT, folder);
    await mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}.${EXTENSION_BY_MIME[file.mimetype]}`;
    const diskPath = join(dir, filename);
    await writeFile(diskPath, file.buffer);

    return { url: `/uploads/${folder}/${filename}`, path: diskPath };
  }

  saveImage(
    folder: 'avatars' | 'logos',
    file: Express.Multer.File,
  ): Promise<{ url: string; path: string }> {
    return this.save(
      folder,
      file,
      ALLOWED_IMAGE_MIME_TYPES,
      MAX_IMAGE_SIZE_BYTES,
    );
  }

  /** PDF, JPG/JPEG, or PNG — used for onboarding registration/certificate uploads. */
  saveDocument(
    folder: 'onboarding-documents',
    file: Express.Multer.File,
  ): Promise<{ url: string; path: string }> {
    return this.save(
      folder,
      file,
      ALLOWED_DOCUMENT_MIME_TYPES,
      MAX_DOCUMENT_SIZE_BYTES,
    );
  }

  /**
   * Stores a trade-data import file privately and returns an opaque key
   * (never a disk path). Callers validate format/size first.
   */
  async savePrivateDataFile(
    buffer: Buffer,
    extension: 'csv' | 'json',
  ): Promise<{ storageKey: string }> {
    const dir = join(PRIVATE_ROOT, 'trade-data-imports');
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${extension}`;
    await writeFile(join(dir, name), buffer);
    return { storageKey: `private:trade-data-imports/${name}` };
  }

  /**
   * Validates (MIME allow-list, size, extension ↔ MIME) and stores a file
   * privately. Returns an opaque key — never a disk path or public URL.
   */
  async savePrivateFile(
    folder: 'lead-attachments' | 'inquiry-attachments' | 'po-attachments',
    file: Express.Multer.File,
    allowed: Record<string, string[]>,
    maxSizeBytes: number,
  ): Promise<{ storageKey: string }> {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    const allowedExtensions = allowed[file.mimetype];
    if (!allowedExtensions)
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}.`);
    if (file.size > maxSizeBytes)
      throw new BadRequestException(
        `File must be ${Math.round(maxSizeBytes / (1024 * 1024))}MB or smaller.`,
      );
    const extension = extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(extension))
      throw new BadRequestException(
        'File extension does not match its content type.',
      );
    const dir = join(PRIVATE_ROOT, folder);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}${extension}`;
    await writeFile(join(dir, name), file.buffer);
    return { storageKey: `private:${folder}/${name}` };
  }

  private privatePath(storageKey: string): string {
    const m = PRIVATE_KEY_RE.exec(storageKey);
    if (!m) throw new BadRequestException('Invalid storage key.');
    return join(PRIVATE_ROOT, m[1], m[2]);
  }

  readPrivateFile(storageKey: string): Promise<Buffer> {
    return readFile(this.privatePath(storageKey));
  }

  async deletePrivateFile(storageKey: string): Promise<void> {
    await unlink(this.privatePath(storageKey)).catch(() => undefined);
  }

  async deleteByUrl(url: string | null | undefined): Promise<void> {
    if (!url || !url.startsWith('/uploads/')) return;
    const diskPath = join(process.cwd(), url);
    await unlink(diskPath).catch(() => undefined);
  }
}
