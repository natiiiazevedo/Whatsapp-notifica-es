import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { User } from '@sales/shared';

interface JWTPayload {
  sub: string;       // user_id
  company_id: string;
  role: string;
  name: string;
  iat: number;
  exp: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string;
      company_id: string;
      role: User['role'];
      name: string;
    };
  }
}

export default fp(async (fastify: FastifyInstance) => {
  const secret = process.env.JWT_SECRET!;

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.code(401).send({ error: 'Token não fornecido' });
      }

      const payload = jwt.verify(token, secret) as JWTPayload;

      request.user = {
        id: payload.sub,
        company_id: payload.company_id,
        role: payload.role as User['role'],
        name: payload.name,
      };

      // Aplica variáveis de sessão para RLS do PostgreSQL
      await fastify.db.query(
        `SELECT set_config('app.current_user_id', $1, TRUE),
                set_config('app.current_user_role', $2, TRUE),
                set_config('app.current_company_id', $3, TRUE)`,
        [payload.sub, payload.role, payload.company_id]
      );
    } catch {
      return reply.code(401).send({ error: 'Token inválido ou expirado' });
    }
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
