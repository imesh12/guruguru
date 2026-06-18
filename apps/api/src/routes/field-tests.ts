import fs from 'node:fs/promises';
import path from 'node:path';

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { prisma } from '../services/prisma.js';
import { FileLogger } from '../services/file-logger.js';
import { resolveAppDataDir } from '../services/runtime-config.js';

const startSessionSchema = z.object({
  operatorName: z.string().trim().min(1),
  notes: z.string().trim().optional(),
});

const updateItemSchema = z.object({
  status: z.enum(['PENDING', 'PASSED', 'FAILED']),
  notes: z.string().optional(),
});

const finishSessionSchema = z.object({
  sessionId: z.string(),
  status: z.enum(['PASSED', 'FAILED']),
  notes: z.string().optional(),
});

const fieldTestItems = [
  { category: 'Cameras', label: 'Vehicle 1 front camera live' },
  { category: 'Cameras', label: 'Vehicle 1 internal camera live' },
  { category: 'Cameras', label: 'Vehicle 2 front camera live' },
  { category: 'Cameras', label: 'Vehicle 2 internal camera live' },
  { category: 'GPS', label: 'Vehicle 1 GPS online' },
  { category: 'GPS', label: 'Vehicle 2 GPS online' },
  { category: 'Map', label: 'Vehicle 1 marker moves smoothly' },
  { category: 'Map', label: 'Vehicle 2 marker moves smoothly' },
  { category: 'System Health', label: 'System Status page shows no red errors' },
  { category: 'System Health', label: 'App restarts after service restart' },
  { category: 'Operator Workflow', label: 'Operator can open video wall' },
  { category: 'Operator Workflow', label: 'Operator can open map' },
  { category: 'Operator Workflow', label: 'Operator can open large camera popup' },
] as const;

const reportsDir = () => path.resolve(resolveAppDataDir(), 'reports');

const serializeSession = (session: {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  operatorName: string;
  notes: string | null;
  status: 'RUNNING' | 'PASSED' | 'FAILED';
  items: Array<{
    id: string;
    category: string;
    label: string;
    status: 'PENDING' | 'PASSED' | 'FAILED';
    notes: string | null;
    checkedAt: Date | null;
  }>;
}) => ({
  id: session.id,
  startedAt: session.startedAt.toISOString(),
  endedAt: session.endedAt?.toISOString() ?? null,
  operatorName: session.operatorName,
  notes: session.notes,
  status: session.status,
  items: session.items.map((item) => ({
    id: item.id,
    category: item.category,
    label: item.label,
    status: item.status,
    notes: item.notes,
    checkedAt: item.checkedAt?.toISOString() ?? null,
  })),
});

const buildMarkdownReport = (session: ReturnType<typeof serializeSession>) => {
  const lines = [
    '# Kurukuru Monitor Field Test Report',
    '',
    `- Session ID: ${session.id}`,
    `- Operator: ${session.operatorName}`,
    `- Started: ${session.startedAt}`,
    `- Ended: ${session.endedAt ?? 'In progress'}`,
    `- Result: ${session.status}`,
    `- Notes: ${session.notes || 'None'}`,
    '',
    '| Category | Item | Status | Checked At | Notes |',
    '| --- | --- | --- | --- | --- |',
    ...session.items.map(
      (item) =>
        `| ${item.category} | ${item.label} | ${item.status} | ${item.checkedAt ?? ''} | ${(item.notes ?? '').replace(/\|/g, '\\|')} |`,
    ),
    '',
  ];
  return lines.join('\n');
};

const exportSessionReport = async (sessionId: string) => {
  const session = await prisma.fieldTestSession.findUnique({
    where: { id: sessionId },
    include: { items: { orderBy: [{ category: 'asc' }, { label: 'asc' }] } },
  });

  if (!session) {
    throw new Error('Field test session not found');
  }

  const normalized = serializeSession(session);
  await fs.mkdir(reportsDir(), { recursive: true });
  const filePath = path.join(reportsDir(), `${normalized.startedAt.slice(0, 19).replace(/[:T]/g, '-')}-${normalized.id}.md`);
  await fs.writeFile(filePath, buildMarkdownReport(normalized), 'utf8');

  return {
    reportPath: filePath,
    session: normalized,
  };
};

export const fieldTestRoutes: FastifyPluginAsync = async (app) => {
  const fieldTestLog = new FileLogger('field-test');
  app.addHook('onRequest', app.requireAdminToken);

  app.post('/field-tests/start', async (request, reply) => {
    const parsed = startSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid field test session payload',
        issues: parsed.error.issues,
      };
    }

    const existing = await prisma.fieldTestSession.findFirst({
      where: { status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
      include: { items: true },
    });
    if (existing) {
      return { session: serializeSession(existing) };
    }

    const session = await prisma.fieldTestSession.create({
      data: {
        operatorName: parsed.data.operatorName,
        notes: parsed.data.notes ?? null,
        status: 'RUNNING',
        items: {
          create: fieldTestItems.map((item) => ({
            category: item.category,
            label: item.label,
            status: 'PENDING',
          })),
        },
      },
      include: { items: true },
    });

    reply.status(201);
    await fieldTestLog.info('Field test session started.', { sessionId: session.id, operatorName: session.operatorName });
    return { session: serializeSession(session) };
  });

  app.get('/field-tests/current', async () => {
    const session = await prisma.fieldTestSession.findFirst({
      where: { status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
      include: { items: { orderBy: [{ category: 'asc' }, { label: 'asc' }] } },
    });

    return {
      session: session ? serializeSession(session) : null,
    };
  });

  app.put('/field-tests/items/:id', async (request, reply) => {
    const params = z.object({ id: z.string() }).safeParse(request.params);
    const parsed = updateItemSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid field test item payload',
        issues: [...(params.success ? [] : params.error.issues), ...(parsed.success ? [] : parsed.error.issues)],
      };
    }

    const item = await prisma.fieldTestItem.update({
      where: { id: params.data.id },
      data: {
        status: parsed.data.status,
        notes: parsed.data.notes ?? null,
        checkedAt: parsed.data.status === 'PENDING' ? null : new Date(),
      },
    });

    const session = await prisma.fieldTestSession.findUniqueOrThrow({
      where: { id: item.sessionId },
      include: {
        items: { orderBy: [{ category: 'asc' }, { label: 'asc' }] },
      },
    });

    await fieldTestLog.info('Field test item updated.', { sessionId: session.id, itemId: item.id, status: item.status });
    return {
      item: {
        id: item.id,
        status: item.status,
        notes: item.notes,
        checkedAt: item.checkedAt?.toISOString() ?? null,
      },
      session: serializeSession(session),
    };
  });

  app.post('/field-tests/finish', async (request, reply) => {
    const parsed = finishSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid field test finish payload',
        issues: parsed.error.issues,
      };
    }

    const session = await prisma.fieldTestSession.update({
      where: { id: parsed.data.sessionId },
      data: {
        status: parsed.data.status,
        notes: parsed.data.notes ?? null,
        endedAt: new Date(),
      },
      include: { items: { orderBy: [{ category: 'asc' }, { label: 'asc' }] } },
    });

    const report = await exportSessionReport(session.id);
    await fieldTestLog.info('Field test session finished.', { sessionId: session.id, status: session.status, reportPath: report.reportPath });
    return {
      session: serializeSession(session),
      reportPath: report.reportPath,
    };
  });

  app.get('/field-tests/history', async () => {
    const sessions = await prisma.fieldTestSession.findMany({
      orderBy: { startedAt: 'desc' },
      include: { items: { orderBy: [{ category: 'asc' }, { label: 'asc' }] } },
      take: 20,
    });

    return {
      sessions: sessions.map((session: (typeof sessions)[number]) => serializeSession(session)),
    };
  });

  app.post('/field-tests/:id/export', async (request, reply) => {
    const params = z.object({ id: z.string() }).safeParse(request.params);
    if (!params.success) {
      reply.status(400);
      return {
        message: 'Invalid field test id',
        issues: params.error.issues,
      };
    }

    const report = await exportSessionReport(params.data.id);
    await fieldTestLog.info('Field test report exported.', { sessionId: params.data.id, reportPath: report.reportPath });
    return report;
  });
};
