import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
];
export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

const UPLOAD_ROOT = join(process.cwd(), 'uploads');
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Local-disk storage adapter. Files land in apps/api/uploads/<folder>/
 * and are served statically from /uploads (see main.ts). This is a
 * development/single-instance adapter — swapping to S3/GCS later means
 * replacing this class's two methods, not touching any caller, since
 * callers only ever see `{ url }` back.
 */
@Injectable()
export class StorageService {
  async saveImage(
    folder: 'avatars' | 'logos',
    file: Express.Multer.File,
  ): Promise<{ url: string; path: string }> {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported image type: ${file.mimetype}. Allowed: PNG, JPEG, WEBP.`,
      );
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new BadRequestException('Image must be 2MB or smaller.');
    }

    const dir = join(UPLOAD_ROOT, folder);
    await mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}.${EXTENSION_BY_MIME[file.mimetype]}`;
    const diskPath = join(dir, filename);
    await writeFile(diskPath, file.buffer);

    return { url: `/uploads/${folder}/${filename}`, path: diskPath };
  }

  async deleteByUrl(url: string | null | undefined): Promise<void> {
    if (!url || !url.startsWith('/uploads/')) return;
    const diskPath = join(process.cwd(), url);
    await unlink(diskPath).catch(() => undefined);
  }
}
