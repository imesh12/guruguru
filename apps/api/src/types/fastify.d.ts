import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    requireAdminToken: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export {};
