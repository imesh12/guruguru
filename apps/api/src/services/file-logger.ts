import fs from 'node:fs/promises';
import path from 'node:path';

import { sanitizeForLogs } from './redaction.js';
import { getLogRetentionDays, resolveLogsDir } from './runtime-config.js';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

const serializeContext = (context: Record<string, unknown> | undefined) => {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }

  return ` ${JSON.stringify(sanitizeForLogs(context))}`;
};

export class FileLogger {
  private readonly logsDir = resolveLogsDir();
  private currentDay = isoDay(new Date());

  constructor(private readonly channel: 'api' | 'desktop' | 'gps' | 'field-test') {}

  async info(message: string, context?: Record<string, unknown>) {
    await this.write('INFO', message, context);
  }

  async warn(message: string, context?: Record<string, unknown>) {
    await this.write('WARN', message, context);
  }

  async error(message: string, context?: Record<string, unknown>) {
    await this.write('ERROR', message, context);
  }

  private async write(level: LogLevel, message: string, context?: Record<string, unknown>) {
    await fs.mkdir(this.logsDir, { recursive: true });
    await this.rotateIfNeeded();

    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}${serializeContext(context)}\n`;
    await fs.appendFile(path.join(this.logsDir, `${this.channel}.log`), line, 'utf8');
  }

  private async rotateIfNeeded() {
    const today = isoDay(new Date());
    if (today === this.currentDay) {
      return;
    }

    const currentPath = path.join(this.logsDir, `${this.channel}.log`);
    const archivedPath = path.join(this.logsDir, `${this.channel}-${this.currentDay}.log`);
    try {
      await fs.rename(currentPath, archivedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    this.currentDay = today;
    await this.cleanup();
  }

  private async cleanup() {
    const retentionDays = getLogRetentionDays();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const files = await fs.readdir(this.logsDir, { withFileTypes: true });

    await Promise.all(
      files
        .filter((entry) => entry.isFile() && entry.name.startsWith(`${this.channel}-`) && entry.name.endsWith('.log'))
        .map(async (entry) => {
          const fullPath = path.join(this.logsDir, entry.name);
          const stats = await fs.stat(fullPath);
          if (stats.mtimeMs < cutoff) {
            await fs.rm(fullPath, { force: true });
          }
        }),
    );
  }
}
