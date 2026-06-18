import crypto from 'node:crypto';

import { prisma } from './prisma.js';

const ENCRYPTED_PREFIX = 'enc:aes256gcm:';

type LoggerLike = {
  warn: (context: Record<string, unknown>, message: string) => void;
};

const getKey = () => {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw) {
    return null;
  }

  try {
    const base64Decoded = Buffer.from(raw, 'base64');
    if (base64Decoded.length === 32) {
      return base64Decoded;
    }

    if (/^[0-9a-f]{64}$/iu.test(raw)) {
      const hexDecoded = Buffer.from(raw, 'hex');
      if (hexDecoded.length === 32) {
        return hexDecoded;
      }
    }

    return null;
  } catch {
    return null;
  }
};

export const hasCredentialEncryptionKey = () => getKey() !== null;

export const warnIfCredentialKeyMissing = (logger: LoggerLike) => {
  if (hasCredentialEncryptionKey()) {
    return;
  }

  logger.warn(
    { nodeEnv: process.env.NODE_ENV ?? 'development' },
    process.env.NODE_ENV === 'production'
      ? 'CREDENTIAL_ENCRYPTION_KEY is not set. Camera passwords remain plaintext at rest until a key is configured.'
      : 'CREDENTIAL_ENCRYPTION_KEY is not set. Development mode will keep supporting plaintext camera passwords.',
  );
};

export const isEncryptedPassword = (value: string | null | undefined) => Boolean(value?.startsWith(ENCRYPTED_PREFIX));

export const encryptPassword = (plaintext: string) => {
  const key = getKey();
  if (!key) {
    return plaintext;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
};

export const decryptPassword = (storedValue: string | null | undefined) => {
  if (!storedValue) {
    return null;
  }

  if (!isEncryptedPassword(storedValue)) {
    return storedValue;
  }

  const key = getKey();
  if (!key) {
    return null;
  }

  const payload = storedValue.slice(ENCRYPTED_PREFIX.length);
  const [ivRaw, tagRaw, encryptedRaw] = payload.split(':');
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    return null;
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
};

export const migratePlaintextPasswordIfPossible = async (cameraId: string, password: string | null | undefined) => {
  if (!password || isEncryptedPassword(password) || !hasCredentialEncryptionKey()) {
    return;
  }

  await prisma.camera.update({
    where: { id: cameraId },
    data: {
      password: encryptPassword(password),
    },
  });
};
