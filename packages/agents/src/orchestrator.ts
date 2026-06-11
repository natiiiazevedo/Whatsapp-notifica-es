import Anthropic from '@anthropic-ai/sdk';
import type { AgentContext, AgentResponse, AgentType } from '@sales/shared';
import type { AgentDeps } from './base.js';
import { FeedbackAgent } from './feedback.js';
import { CarteiraAgent } from './carteira.js';
import { ManagerAgent } from './manager.js';
import { GamificationAgent } from './gamification.js';
import { InactivityAgent } from './inactivity.js';
import { AgendaAgent } from './agenda.js';
import { DealAgent } from './deal.js';
import { PostSalesAgent } from './postsales.js';

// OrchestratorAgent - Roteador inteligente que delega para o agente especializado certo
export class OrchestratorAgent {
  private agents: Map<AgentType, InstanceType<typeof FeedbackAgent>>;
  private model = 'claude-sonnet-4-6';

  constructor(private deps: AgentDeps) {
    this.agents = new Map([
      ['feedback', new FeedbackAgent('feedback', deps)],
      ['carteira', new CarteiraAgent('carteira', deps)],
      ['manager', new ManagerAgent('manager', deps)],
      ['gamification', new GamificationAgent('gamification', deps)],
      ['inactivity', new InactivityAgent('inactivity', deps)],
      ['agenda', new AgendaAgent('agenda', deps)],
      ['deal', new DealAgent('deal', deps)],
      ['postsales', new PostSalesAgent('postsales', deps)],
    ]);
  }

  async route(userMessage: string, ctx: AgentContext): Promise<AgentResponse> {
    // 1. Determina qual agente deve responder
    const agentType = await this.classify(userMessage, ctx);

    // 2. Verifica permissão (gestor tenta usar agente de manager, etc.)
    const authorizedType = this.authorize(agentType, ctx);

    // 3. Delega para o agente especializado
    const agent = this.agents.get(authorizedType);
    if (!agent) {
      return {
        message: 'Desculpe, não encontrei um agente adequado para sua solicitação.',
        agent_type: 'orchestrator',
      };
    }

    return agent.run(userMessage, ctx);
  }

  private async classify(message: string, ctx: AgentContext): Promise<AgentType> {
    // Classificação rápida via LLM (sem tools, apenas texto)
    const response = await this.deps.anthropic.messages.create({
      model: this.model,
      max_tokens: 50,
      system: `Você classifica mensagens de usuários de uma plataforma comercial.
Responda APENAS com uma das opções: feedback, carteira, deal, postsales, manager, gamification, inactivity, agenda

- agenda: tarefas do dia, o que fazer, o que fiz, minha agenda, reuniões de hoje, ligações feitas, KPIs do dia, produtividade, criar tarefa, marcar como feito
- feedback: coaching pessoal, meu desempenho, minhas métricas, como estou indo, análise de resultados
- carteira: carteira de clientes, clientes sem contato, lista de prioridades de prospectos
- deal: analisar negócio específico, health score, o que falta para fechar, próximo passo de um deal, risco de perder negócio, comparar negócios, qual deal priorizar
- postsales: pós-venda, churn, cliente inativo pós-fechamento, reativar cliente, NPS, upsell, clientes que já compraram, satisfação do cliente, expansão de conta
- manager: equipe inteira, pipeline geral, forecast, gargalos (só gestores)
- gamification: ranking, pontos, conquistas, meu nível, placar
- inactivity: alertas de inatividade, negócios parados, varredura automática

Contexto: usuário é ${ctx.user_role}.`,
      messages: [{ role: 'user', content: message }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim().toLowerCase() : '';
    const valid: AgentType[] = ['feedback', 'carteira', 'deal', 'postsales', 'manager', 'gamification', 'inactivity', 'agenda'];

    return (valid.find(v => text.includes(v)) as AgentType | undefined) ?? 'feedback';
  }

  private authorize(agentType: AgentType, ctx: AgentContext): AgentType {
    // Vendedores não podem acessar o ManagerAgent diretamente
    if (agentType === 'manager' && ctx.user_role === 'salesperson') {
      return 'feedback';
    }
    return agentType;
  }

  // Acessa um agente específico diretamente (para chamadas programáticas)
  getAgent(type: AgentType) {
    return this.agents.get(type);
  }
}
