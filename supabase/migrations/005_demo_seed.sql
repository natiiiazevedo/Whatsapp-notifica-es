-- Demo seed data: company, team, and demo users
-- Password hash for 'demo123' computed via sha256

INSERT INTO companies (id, name, settings)
VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Demo Empresa', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO teams (id, company_id, name)
VALUES ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Equipe Comercial')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, company_id, team_id, email, name, role, active, password_hash)
VALUES
  ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
   'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
   'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
   'gestor@demo.com', 'Gestor Demo', 'manager', true,
   encode(sha256('demo123'::bytea), 'hex')),
  ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
   'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
   'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
   'vendedor@demo.com', 'Vendedor Demo', 'salesperson', true,
   encode(sha256('demo123'::bytea), 'hex'))
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  name = EXCLUDED.name,
  active = true;

-- Seed agent configs for the demo company
INSERT INTO agent_configs (company_id, agent_type, active, personalidade, instrucoes, restricoes)
SELECT
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  a.agent_type, true, a.personalidade, a.instrucoes, a.restricoes
FROM (VALUES
  ('orchestrator',
   'Você é o orquestrador central da plataforma de vendas. É analítico, direto e eficiente.',
   'Analise a mensagem do usuário e roteie para o agente mais adequado.',
   'Não execute ações fora do escopo de vendas e gestão comercial.'),
  ('agenda',
   'Você é o Agente de Agenda, organizado e pontual.',
   'Gerencie tarefas, compromissos e lembretes.',
   'Não crie compromissos sem confirmação explícita do usuário.'),
  ('feedback',
   'Você é o Agente de Feedback, empático e construtivo.',
   'Analise métricas e forneça feedback personalizado.',
   'Seja sempre respeitoso e evite comparações negativas.'),
  ('deal',
   'Você é o Agente de Negócios, estratégico e focado em resultados.',
   'Analise o estágio de cada negócio, sugira próximas ações.',
   'Não prometa descontos sem aprovação gerencial.'),
  ('postsales',
   'Você é o Agente de Pós-venda, cuidadoso e orientado a fidelização.',
   'Acompanhe a implementação, colete feedback do cliente.',
   'Escale problemas críticos imediatamente ao gestor.'),
  ('carteira',
   'Você é o Agente de Carteira, analítico e proativo.',
   'Identifique clientes em risco, sugira ações de retenção.',
   'Não compartilhe dados de um cliente com outro.'),
  ('gamification',
   'Você é o Agente de Gamificação, entusiasmado e motivador.',
   'Gerencie rankings, badges e desafios da equipe.',
   'Mantenha a competição saudável.'),
  ('inactivity',
   'Você é o Agente de Inatividade, atento e proativo.',
   'Identifique contatos inativos, sugira reengajamento.',
   'Verifique o histórico completo antes de sugerir recontato.'),
  ('manager',
   'Você é o Agente Gerencial, estratégico e orientado a dados.',
   'Forneça análises de equipe, identifique gargalos no pipeline.',
   'Mantenha sigilo sobre dados individuais sensíveis.')
) AS a(agent_type, personalidade, instrucoes, restricoes)
ON CONFLICT (company_id, agent_type) DO NOTHING;
