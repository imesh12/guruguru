import fs from 'node:fs/promises';
import path from 'node:path';

const retentionDays = Number(process.env.LOG_RETENTION_DAYS ?? 14);

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export class DesktopFileLogger {
  private readonly logsDir = path.resolve(process.env.APP_DATA_DIR ?? './data', 'logs');
  private currentDay = isoDay(new Date());

  constructor(private readonly channel: 'desktop' | 'api' | 'gps' | 'field-test' = 'desktop') {}

  async info(message: string, context?: Record<string, unknown>) {
    await this.write('INFO', message, context);
  }

  async warn(message: string, context?: Record<string, unknown>) {
    await this.write('WARN', message, context);
  }

  async error(message: string, context?: Record<string, unknown>) {
    await this.write('ERROR', message, context);
  }

  private async write(level: 'INFO' | 'WARN' | 'ERROR', message: string, context?: Record<string, unknown>) {
    await fs.mkdir(this.logsDir, { recursive: true });
    await this.rotateIfNeeded();

    const line = `[${new Date().toISOString()}] [${level}] ${message}${context ? ` ${JSON.stringify(context)}` : ''}\n`;
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
