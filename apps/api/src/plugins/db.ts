import fp from 'fastify-plugin';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Testa conexão na inicialização
  await pool.query('SELECT 1');
  fastify.log.info('PostgreSQL connected');

  fastify.decorate('db', pool);
  fastify.addHook('onClose', async () => { await pool.end(); });
});
