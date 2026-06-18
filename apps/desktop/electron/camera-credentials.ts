import crypto from 'node:crypto';

const ENCRYPTED_PREFIX = 'enc:aes256gcm:';

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
      return hexDecoded.length === 32 ? hexDecoded : null;
    }

    return null;
  } catch {
    return null;
  }
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
