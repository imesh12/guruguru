import type { FastifyReply, FastifyRequest } from 'fastify';

export const getApiHost = () => process.env.API_HOST?.trim() || '127.0.0.1';

export const getApiToken = () => process.env.API_TOKEN?.trim() || null;

/**
 * Vehicle agent separation is based on `vehicleId` plus agent bearer token.
 *
 * Router IP is intentionally not used for identity because multiple vehicles
 * can each have a local in-vehicle router at the same address such as
 * `192.168.0.1`.
 */
export const getVehicleAgentTokens = () => {
  const raw = process.env.VEHICLE_AGENT_TOKENS?.trim();
  if (!raw) {
    return new Map<string, string>();
  }

  const pairs = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const tokens = new Map<string, string>();
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex === pair.length - 1) {
      throw new Error(`Invalid VEHICLE_AGENT_TOKENS entry "${pair}". Expected vehicleId:token.`);
    }

    const vehicleId = pair.slice(0, separatorIndex).trim();
    const token = pair.slice(separatorIndex + 1).trim();
    if (!vehicleId || !token) {
      throw new Error(`Invalid VEHICLE_AGENT_TOKENS entry "${pair}". Expected vehicleId:token.`);
    }

    tokens.set(vehicleId, token);
  }

  return tokens;
};

export const buildAdminHeaders = () => {
  const token = getApiToken();
  return token
    ? {
        authorization: `Bearer ${token}`,
      }
    : {};
};

export const requireAdminToken = async (request: FastifyRequest, reply: FastifyReply) => {
  const token = getApiToken();
  if (!token) {
    return;
  }

  const authorization = request.headers.authorization;
  if (authorization === `Bearer ${token}`) {
    return;
  }

  reply.status(401);
  throw new Error('Unauthorized');
};

export const requireVehicleAgentToken = async (
  request: FastifyRequest,
  reply: FastifyReply,
  vehicleId: string,
) => {
  const authorization = request.headers.authorization?.trim();
  if (!authorization?.startsWith('Bearer ')) {
    reply.status(401);
    throw new Error('Missing vehicle agent authorization token.');
  }

  const presentedToken = authorization.slice('Bearer '.length).trim();
  if (!presentedToken) {
    reply.status(401);
    throw new Error('Missing vehicle agent authorization token.');
  }

  const tokenMap = getVehicleAgentTokens();
  const expectedToken = tokenMap.get(vehicleId);
  if (!expectedToken || expectedToken !== presentedToken) {
    reply.status(403);
    throw new Error('Forbidden');
  }
};
