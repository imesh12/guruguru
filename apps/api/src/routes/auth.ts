import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  createAdminSessionToken,
  getAdminSessionTokenFromHeaders,
  isAdminAuthConfigured,
  verifyAdminCredentials,
  verifyAdminSessionToken,
} from '../services/admin-auth.js';

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', async (request, reply) => {
    if (!isAdminAuthConfigured()) {
      reply.status(503);
      return {
        message: 'Admin authentication is not configured.',
      };
    }

    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid login payload',
        issues: parsed.error.issues,
      };
    }

    const { username, password } = parsed.data;
    if (!verifyAdminCredentials(username, password)) {
      reply.status(401);
      return {
        message: 'Invalid username or password.',
      };
    }

    const session = createAdminSessionToken(username);
    return {
      role: 'admin' as const,
      username,
      token: session.token,
      expiresAt: session.expiresAt,
    };
  });

  app.get('/me', async (request, reply) => {
    if (!isAdminAuthConfigured()) {
      reply.status(503);
      return {
        message: 'Admin authentication is not configured.',
      };
    }

    const token = getAdminSessionTokenFromHeaders(request.headers);
    if (!token) {
      reply.status(401);
      return {
        message: 'Missing admin session.',
      };
    }

    const payload = verifyAdminSessionToken(token);
    if (!payload) {
      reply.status(401);
      return {
        message: 'Invalid or expired admin session.',
      };
    }

    return {
      role: payload.role,
      username: payload.sub,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  });
};
