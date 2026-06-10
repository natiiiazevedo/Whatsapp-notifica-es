import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { User } from '@sales/shared';

export async function authRoutes(fastify: FastifyInstance) {
  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
  });

  // POST /api/auth/login
  fastify.post('/login', async (request, reply) => {
    const { email, password } = loginSchema.parse(request.body);

    const res = await fastify.db.query<User & { password_hash: string }>(
      `SELECT u.*, uc.password_hash
       FROM users u
       JOIN user_credentials uc ON uc.user_id = u.id
       WHERE u.email = $1 AND u.active = true`,
      [email]
    );

    if (res.rows.length === 0) {
      return reply.code(401).send({ error: 'Credenciais inválidas' });
    }

    const user = res.rows[0];
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

    if (user.password_hash !== passwordHash) {
      return reply.code(401).send({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        company_id: user.company_id,
        role: user.role,
        name: user.name,
      },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRY ?? '7d' }
    );

    await fastify.db.query(
      `UPDATE users SET last_seen_at = NOW() WHERE id = $1`,
      [user.id]
    );

    return reply.send({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        company_id: user.company_id,
        team_id: user.team_id,
        avatar_url: user.avatar_url,
      },
    });
  });

  // GET /api/auth/me
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const res = await fastify.db.query<User>(
      `SELECT id, name, email, role, company_id, team_id, avatar_url, whatsapp, last_seen_at
       FROM users WHERE id = $1`,
      [request.user.id]
    );
    return reply.send(res.rows[0]);
  });

  // POST /api/auth/logout
  fastify.post('/logout', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    // Stateless JWT — invalida via token blacklist se necessário
    return reply.send({ success: true });
  });
}
