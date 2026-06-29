import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const ADMIN_SESSION_TOKEN_VERSION = 1;

type AdminSessionPayload = {
  v: number;
  sub: string;
  role: 'admin';
  iat: number;
  exp: number;
};

const base64UrlEncode = (value: string | Buffer) => Buffer.from(value).toString('base64url');

const base64UrlDecode = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

const safeEqual = (left: Buffer, right: Buffer) => {
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
};

const compareText = (left: string, right: string) => safeEqual(Buffer.from(left), Buffer.from(right));

export const getAdminUsername = () => process.env.ADMIN_USERNAME?.trim() || null;

export const getAdminPasswordHash = () => process.env.ADMIN_PASSWORD_HASH?.trim() || null;

export const getAdminSessionSecret = () => process.env.ADMIN_SESSION_SECRET?.trim() || null;

export const getAdminSessionTtlSeconds = () => {
  const raw = Number(process.env.ADMIN_SESSION_TTL_SECONDS ?? 28800);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 28800;
};

export const isAdminAuthConfigured = () =>
  Boolean(getAdminUsername() && getAdminPasswordHash() && getAdminSessionSecret());

const verifySha256Hash = (password: string, expectedHash: string) => {
  const digest = createHash('sha256').update(password, 'utf8').digest('hex');
  return compareText(digest, expectedHash);
};

const verifyScryptHash = (password: string, saltBase64: string, expectedHashBase64: string) => {
  const salt = Buffer.from(saltBase64, 'base64');
  const expected = Buffer.from(expectedHashBase64, 'base64');
  const derived = scryptSync(password, salt, expected.length);
  return safeEqual(derived, expected);
};

const verifyPlainHashForDev = (password: string, expectedPassword: string) => {
  if (process.env.ALLOW_INSECURE_ADMIN_PASSWORD !== 'true') {
    return false;
  }

  return compareText(password, expectedPassword);
};

export const verifyAdminPassword = (password: string) => {
  const configuredHash = getAdminPasswordHash();
  if (!configuredHash) {
    return false;
  }

  if (configuredHash.startsWith('sha256:')) {
    return verifySha256Hash(password, configuredHash.slice('sha256:'.length));
  }

  if (configuredHash.startsWith('scrypt:')) {
    const [, saltBase64 = '', expectedHashBase64 = ''] = configuredHash.split(':');
    if (!saltBase64 || !expectedHashBase64) {
      return false;
    }

    return verifyScryptHash(password, saltBase64, expectedHashBase64);
  }

  if (configuredHash.startsWith('plain:')) {
    return verifyPlainHashForDev(password, configuredHash.slice('plain:'.length));
  }

  return verifySha256Hash(password, configuredHash);
};

export const verifyAdminCredentials = (username: string, password: string) => {
  const configuredUsername = getAdminUsername();
  if (!configuredUsername) {
    return false;
  }

  if (!compareText(username, configuredUsername)) {
    return false;
  }

  return verifyAdminPassword(password);
};

const signPayload = (payloadBase64Url: string) => {
  const secret = getAdminSessionSecret();
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET is not configured.');
  }

  return createHmac('sha256', secret).update(payloadBase64Url).digest('base64url');
};

export const createAdminSessionToken = (username: string) => {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = getAdminSessionTtlSeconds();
  const payload: AdminSessionPayload = {
    v: ADMIN_SESSION_TOKEN_VERSION,
    sub: username,
    role: 'admin',
    iat: now,
    exp: now + ttlSeconds,
  };

  const payloadBase64Url = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(payloadBase64Url);

  return {
    token: `${payloadBase64Url}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
};

export const verifyAdminSessionToken = (token: string): AdminSessionPayload | null => {
  const [payloadBase64Url, signature] = token.split('.');
  if (!payloadBase64Url || !signature) {
    return null;
  }

  const expectedSignature = signPayload(payloadBase64Url);
  if (!compareText(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadBase64Url)) as AdminSessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (
      payload.v !== ADMIN_SESSION_TOKEN_VERSION
      || payload.role !== 'admin'
      || typeof payload.sub !== 'string'
      || typeof payload.iat !== 'number'
      || typeof payload.exp !== 'number'
      || payload.exp <= now
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
};

export const getAdminSessionTokenFromHeaders = (headers: Record<string, unknown>) => {
  const direct = headers['x-admin-session'];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  if (Array.isArray(direct)) {
    const first = direct.find((value) => typeof value === 'string' && value.trim());
    if (typeof first === 'string') {
      return first.trim();
    }
  }

  return null;
};

export const createAdminPasswordHash = (password: string) => {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('base64')}:${derived.toString('base64')}`;
};
