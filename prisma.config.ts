import fs from 'node:fs';
import path from 'node:path';

import { defineConfig, env } from 'prisma/config';

const rootEnvPath = path.resolve(process.cwd(), '.env');
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const stripOptionalQuotes = (value: string) => value.replace(/^['"]+|['"]+$/g, '').trim();

if (fs.existsSync(rootEnvPath)) {
  const raw = fs.readFileSync(rootEnvPath, 'utf8');
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!ENV_KEY_PATTERN.test(key) || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = stripOptionalQuotes(trimmed.slice(separatorIndex + 1).trim());
  }
}

process.env.DATABASE_URL ??= 'file:./data/kurukuru.db';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
