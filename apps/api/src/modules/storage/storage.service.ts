import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
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

  async deleteByUrl(url: string | null | undefined): Promise<void> {
    if (!url || !url.startsWith('/uploads/')) return;
    const diskPath = join(process.cwd(), url);
    await unlink(diskPath).catch(() => undefined);
  }
}
