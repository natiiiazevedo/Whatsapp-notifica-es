'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { Send, Loader2, ChevronDown, ChevronUp, X, Zap, Activity } from 'lucide-react';

// ─── Config dos agentes ──────────────────────────────────────

const AGENTS = {
  orchestrator: { label: 'Orquestrador', icon: '⚡', color: '#3B82F6', glow: '#3B82F680', desc: 'Roteador inteligente' },
  feedback:     { label: 'Coach 1:1',    icon: '🎯', color: '#A855F7', glow: '#A855F780', desc: 'Feedback pessoal' },
  carteira:     { label: 'Carteira',     icon: '💼', color: '#22C55E', glow: '#22C55E80', desc: 'Portfólio de clientes' },
  deal:         { label: 'Deal Intel',   icon: '🔍', color: '#F97316', glow: '#F9731680', desc: 'Análise de negócios' },
  postsales:    { label: 'Pós-Vendas',   icon: '🤝', color: '#EC4899', glow: '#EC489980', desc: 'Sucesso do cliente' },
  manager:      { label: 'Gestão',       icon: '📊', color: '#60A5FA', glow: '#60A5FA80', desc: 'Visão da equipe' },
  gamification: { label: 'Gamificação',  icon: '🏆', color: '#EAB308', glow: '#EAB30880', desc: 'Rankings e XP' },
  inactivity:   { label: 'Monitor',      icon: '🚨', color: '#EF4444', glow: '#EF444480', desc: 'Alertas de inatividade' },
  agenda:       { label: 'Agenda',       icon: '📅', color: '#14B8A6', glow: '#14B8A680', desc: 'Tarefas e KPIs' },
} as const;

type AgentKey = keyof typeof AGENTS;

// ─── Posições no grafo (SVG 500×440) ─────────────────────────

const CX = 250, CY = 210, RADIUS = 165;

const POSITIONS: Record<AgentKey, { x: number; y: number }> = {
  orchestrator: { x: CX, y: CY },
  // 8 agentes em círculo, começando do topo, sentido horário
  agenda:       { x: CX + RADIUS * Math.cos(-90  * Math.PI / 180), y: CY + RADIUS * Math.sin(-90  * Math.PI / 180) },
  feedback:     { x: CX + RADIUS * Math.cos(-45  * Math.PI / 180), y: CY + RADIUS * Math.sin(-45  * Math.PI / 180) },
  deal:         { x: CX + RADIUS * Math.cos(0    * Math.PI / 180), y: CY + RADIUS * Math.sin(0    * Math.PI / 180) },
  postsales:    { x: CX + RADIUS * Math.cos(45   * Math.PI / 180), y: CY + RADIUS * Math.sin(45   * Math.PI / 180) },
  gamification: { x: CX + RADIUS * Math.cos(90   * Math.PI / 180), y: CY + RADIUS * Math.sin(90   * Math.PI / 180) },
  inactivity:   { x: CX + RADIUS * Math.cos(135  * Math.PI / 180), y: CY + RADIUS * Math.sin(135  * Math.PI / 180) },
  carteira:     { x: CX + RADIUS * Math.cos(180  * Math.PI / 180), y: CY + RADIUS * Math.sin(180  * Math.PI / 180) },
  manager:      { x: CX + RADIUS * Math.cos(-135 * Math.PI / 180), y: CY + RADIUS * Math.sin(-135 * Math.PI / 180) },
};

const SPOKE_AGENTS: AgentKey[] = ['agenda', 'feedback', 'deal', 'postsales', 'gamification', 'inactivity', 'carteira', 'manager'];

// ─── Tipos de eventos ────────────────────────────────────────

interface StreamEvent {
  type: string;
  content?: string;
  tool?: string;
  agent?: string;
  preview?: string;
  message?: string;
  agent_type?: string;
}

interface ActivityItem {
  id: number;
  type: string;
  text: string;
  agent?: string;
  time: Date;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  agentType?: string;
  streaming?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  get_my_pipeline: 'Buscando pipeline…',
  get_my_metrics: 'Carregando métricas…',
  get_deals_at_risk: 'Analisando riscos…',
  get_active_deals_with_health: 'Calculando health scores…',
  get_deal_detail: 'Carregando detalhes do negócio…',
  get_highest_priority_deal: 'Identificando prioridade máxima…',
  get_won_customers: 'Buscando base de clientes…',
  get_churn_risks: 'Detectando riscos de churn…',
  get_upsell_opportunities: 'Mapeando oportunidades…',
  get_today_agenda: 'Carregando agenda de hoje…',
  get_today_kpis: 'Calculando KPIs do dia…',
  get_team_performance: 'Analisando equipe…',
  get_pipeline_overview: 'Visão do pipeline…',
  get_ranking: 'Buscando ranking…',
  scan_inactivity: 'Varrendo inatividade…',
  default: 'Processando…',
};

function toolLabel(tool: string) {
  return TOOL_LABELS[tool] ?? TOOL_LABELS.default;
}

// ─── Node SVG ────────────────────────────────────────────────

function AgentNode({
  agentKey, pos, selected, active, onClick,
}: {
  agentKey: AgentKey;
  pos: { x: number; y: number };
  selected: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const cfg = AGENTS[agentKey];
  const isOrch = agentKey === 'orchestrator';
  const R = isOrch ? 34 : 26;

  return (
    <g
      className="cursor-pointer"
      onClick={onClick}
      transform={`translate(${pos.x}, ${pos.y})`}
    >
      {/* Glow ring (animated when active) */}
      <circle
        r={R + 10}
        fill="none"
        stroke={cfg.color}
        strokeWidth={active ? 2 : 0.5}
        strokeOpacity={active ? 0.6 : 0.15}
        style={active ? { animation: 'ping 1.2s ease-out infinite' } : undefined}
      />
      {/* Selection ring */}
      {selected && (
        <circle r={R + 6} fill="none" stroke={cfg.color} strokeWidth={2} strokeOpacity={0.9} strokeDasharray="4 3" />
      )}
      {/* Outer circle */}
      <circle r={R} fill={cfg.color} fillOpacity={0.15} stroke={cfg.color} strokeWidth={1.5} strokeOpacity={0.6} />
      {/* Inner fill */}
      <circle r={R - 8} fill={cfg.color} fillOpacity={selected || active ? 0.5 : 0.25} />
      {/* Icon text */}
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={isOrch ? 16 : 13}
        style={{ userSelect: 'none' }}
      >
        {cfg.icon}
      </text>
      {/* Label */}
      <text
        y={R + 14}
        textAnchor="middle"
        fontSize={9.5}
        fill={selected ? cfg.color : '#94A3B8'}
        fontWeight={selected ? '600' : '400'}
        style={{ userSelect: 'none' }}
      >
        {cfg.label}
      </text>
    </g>
  );
}

// ─── Linha animada Orchestrator ↔ Agent ──────────────────────

function ConnectionLine({
  from, to, active, color,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  active: boolean;
  color: string;
}) {
  const id = `grad-${color.replace('#', '')}`;
  return (
    <g>
      <defs>
        <linearGradient id={id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity={active ? 0.8 : 0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={active ? 0.8 : 0.2} />
        </linearGradient>
      </defs>
      <line
        x1={from.x} y1={from.y}
        x2={to.x} y2={to.y}
        stroke={`url(#${id})`}
        strokeWidth={active ? 2 : 1}
        strokeDasharray={active ? undefined : '4 5'}
      />
      {/* Traveling packet when active */}
      {active && (
        <circle r={3} fill={color} opacity={0.9}>
          <animateMotion dur="0.8s" repeatCount="indefinite">
            <mpath href={`#path-${id}`} />
          </animateMotion>
        </circle>
      )}
    </g>
  );
}

// ─── Main Component ──────────────────────────────────────────

export function AgentNetwork({ userRole }: { userRole?: string }) {
  const [selectedAgent, setSelectedAgent] = useState<AgentKey>('orchestrator');
  const [activeAgent, setActiveAgent] = useState<AgentKey | null>(null);
  const [routingTo, setRoutingTo] = useState<AgentKey | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityExpanded, setActivityExpanded] = useState(true);
  const [activityCounter, setActivityCounter] = useState(0);

  const cancelRef = useRef<(() => void) | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addActivity = useCallback((type: string, text: string, agent?: string) => {
    setActivityCounter(c => {
      const id = c + 1;
      setActivity(prev => [{ id, type, text, agent, time: new Date() }, ...prev].slice(0, 40));
      return id;
    });
  }, []);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || isStreaming) return;
    setInput('');
    setIsStreaming(true);

    const targetAgent = selectedAgent === 'orchestrator' ? undefined : selectedAgent;

    setMessages(prev => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', agentType: targetAgent ?? 'orchestrator', streaming: true },
    ]);

    addActivity('user', `Mensagem enviada para ${AGENTS[selectedAgent].label}`);
    setActiveAgent(null);
    setRoutingTo(null);

    let accText = '';

    const cancel = api.agents.chatStream(
      text,
      targetAgent,
      (event) => {
        const e = event as StreamEvent;

        switch (e.type) {
          case 'routing':
            addActivity('routing', 'Orquestrador classificando mensagem…', 'orchestrator');
            setActiveAgent('orchestrator');
            break;

          case 'routed': {
            const dest = e.agent as AgentKey;
            addActivity('routed', `Roteado → ${AGENTS[dest]?.label ?? dest}`, dest);
            setRoutingTo(dest);
            setActiveAgent(dest);
            setMessages(prev => prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, agentType: dest } : m
            ));
            break;
          }

          case 'thinking':
            addActivity('thinking', 'Processando…', e.agent as AgentKey);
            break;

          case 'tool_call': {
            const a = (e.agent ?? selectedAgent) as AgentKey;
            addActivity('tool_call', toolLabel(e.tool ?? ''), a);
            break;
          }

          case 'tool_result':
            addActivity('tool_result', `✓ ${e.tool ?? 'ferramenta'} concluída`, e.agent as AgentKey);
            break;

          case 'delta':
            accText += e.content ?? '';
            setMessages(prev => prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: accText } : m
            ));
            break;

          case 'done':
            setMessages(prev => prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: e.message ?? accText, streaming: false } : m
            ));
            setIsStreaming(false);
            setActiveAgent(null);
            setRoutingTo(null);
            addActivity('done', 'Resposta concluída', e.agent_type as AgentKey);
            break;

          case 'error':
            setMessages(prev => prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: `Erro: ${e.message}`, streaming: false } : m
            ));
            setIsStreaming(false);
            setActiveAgent(null);
            setRoutingTo(null);
            break;
        }
      },
    );

    cancelRef.current = cancel;
  }, [selectedAgent, isStreaming, addActivity]);

  const stopStream = () => {
    cancelRef.current?.();
    setIsStreaming(false);
    setActiveAgent(null);
    setRoutingTo(null);
    setMessages(prev => prev.map((m, i) =>
      i === prev.length - 1 && m.streaming ? { ...m, streaming: false, content: m.content + ' [interrompido]' } : m
    ));
  };

  const orchPos = POSITIONS.orchestrator;

  return (
    <div className="flex h-full" style={{ background: '#08090D' }}>

      {/* ── LEFT: Network Graph ── */}
      <div className="flex flex-col" style={{ width: '52%', minWidth: 0 }}>
        {/* Header metrics */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: '#1A2035', background: '#0D1117' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: '#3B82F620', border: '1px solid #3B82F650' }}>
              <Zap className="w-3.5 h-3.5" style={{ color: '#60A5FA' }} />
            </div>
            <span className="text-sm font-semibold" style={{ color: '#F1F5F9' }}>Agent Lab</span>
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: '#475569' }}>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
              {Object.keys(AGENTS).length} agentes online
            </span>
            {isStreaming && (
              <span className="flex items-center gap-1.5" style={{ color: '#60A5FA' }}>
                <Activity className="w-3 h-3 animate-pulse" />
                Processando
              </span>
            )}
          </div>
        </div>

        {/* SVG Graph */}
        <div className="flex-1 flex items-center justify-center p-4 relative">
          <svg
            viewBox="0 0 500 440"
            className="w-full max-w-lg"
            style={{ filter: 'drop-shadow(0 0 20px #3B82F610)' }}
          >
            <defs>
              <style>{`
                @keyframes ping {
                  0% { transform: scale(1); opacity: 0.6; }
                  70% { transform: scale(1.4); opacity: 0; }
                  100% { transform: scale(1.4); opacity: 0; }
                }
              `}</style>
            </defs>

            {/* Connection lines */}
            {SPOKE_AGENTS.map(key => {
              const pos = POSITIONS[key];
              const isActive = activeAgent === key || routingTo === key;
              return (
                <ConnectionLine
                  key={key}
                  from={orchPos}
                  to={pos}
                  active={isActive}
                  color={AGENTS[key].color}
                />
              );
            })}

            {/* Spoke agent nodes */}
            {SPOKE_AGENTS.map(key => (
              <AgentNode
                key={key}
                agentKey={key}
                pos={POSITIONS[key]}
                selected={selectedAgent === key}
                active={activeAgent === key || routingTo === key}
                onClick={() => setSelectedAgent(key)}
              />
            ))}

            {/* Orchestrator (center, on top) */}
            <AgentNode
              agentKey="orchestrator"
              pos={orchPos}
              selected={selectedAgent === 'orchestrator'}
              active={activeAgent === 'orchestrator' || isStreaming}
              onClick={() => setSelectedAgent('orchestrator')}
            />
          </svg>
        </div>

        {/* Selected agent info bar */}
        <div
          className="px-5 py-3 border-t flex items-center gap-3"
          style={{ borderColor: '#1A2035', background: '#0D1117' }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
            style={{ background: `${AGENTS[selectedAgent].color}20`, border: `1px solid ${AGENTS[selectedAgent].color}50` }}
          >
            {AGENTS[selectedAgent].icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium" style={{ color: AGENTS[selectedAgent].color }}>
              {AGENTS[selectedAgent].label}
            </p>
            <p className="text-xs" style={{ color: '#475569' }}>{AGENTS[selectedAgent].desc}</p>
          </div>
          <p className="text-xs px-2 py-1 rounded-full" style={{ background: `${AGENTS[selectedAgent].color}15`, color: AGENTS[selectedAgent].color, border: `1px solid ${AGENTS[selectedAgent].color}30` }}>
            {selectedAgent === 'orchestrator' ? 'Auto-roteamento' : 'Direto'}
          </p>
        </div>
      </div>

      {/* ── RIGHT: Chat + Activity ── */}
      <div
        className="flex flex-col flex-1 border-l"
        style={{ borderColor: '#1A2035', minWidth: 0 }}
      >
        {/* Activity Log */}
        <div
          className="border-b overflow-hidden"
          style={{
            borderColor: '#1A2035',
            background: '#0D1117',
            maxHeight: activityExpanded ? 180 : 40,
            transition: 'max-height 0.25s ease',
          }}
        >
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs hover:opacity-80"
            style={{ color: '#64748B' }}
            onClick={() => setActivityExpanded(v => !v)}
          >
            <span className="flex items-center gap-1.5">
              <Activity className="w-3 h-3" />
              Log de atividade
              {activity.length > 0 && (
                <span className="rounded-full px-1.5 py-0.5" style={{ background: '#1E2435', color: '#94A3B8' }}>
                  {activity.length}
                </span>
              )}
            </span>
            {activityExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {activityExpanded && (
            <div className="overflow-y-auto px-4 pb-3 space-y-1.5" style={{ maxHeight: 130 }}>
              {activity.length === 0 ? (
                <p className="text-xs py-2" style={{ color: '#334155' }}>Nenhuma atividade ainda. Inicie uma conversa.</p>
              ) : activity.map(item => (
                <div key={item.id} className="flex items-start gap-2 text-xs">
                  <span style={{ color: getActivityColor(item.type), flexShrink: 0, marginTop: 1 }}>
                    {getActivityIcon(item.type)}
                  </span>
                  <span style={{ color: '#64748B' }}>
                    {item.agent && <span style={{ color: AGENTS[item.agent as AgentKey]?.color ?? '#60A5FA' }}>[{AGENTS[item.agent as AgentKey]?.label ?? item.agent}] </span>}
                    {item.text}
                  </span>
                  <span className="ml-auto flex-shrink-0" style={{ color: '#1E2435' }}>
                    {item.time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
                style={{ background: '#3B82F610', border: '1px solid #3B82F630' }}
              >
                ⚡
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: '#94A3B8' }}>Selecione um agente e comece</p>
                <p className="text-xs mt-1" style={{ color: '#334155' }}>Clique em um nó do grafo para escolher o especialista</p>
              </div>
              {/* Quick prompts */}
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {[
                  ['Como está meu pipeline?', 'feedback'],
                  ['Analise meus negócios em risco', 'deal'],
                  ['Quais clientes posso perder?', 'postsales'],
                  ['Minha agenda de hoje', 'agenda'],
                ].map(([prompt, agent]) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setSelectedAgent(agent as AgentKey);
                      setTimeout(() => sendMessage(prompt), 50);
                    }}
                    className="text-xs px-3 py-1.5 rounded-full transition-opacity hover:opacity-80"
                    style={{
                      background: `${AGENTS[agent as AgentKey].color}15`,
                      border: `1px solid ${AGENTS[agent as AgentKey].color}40`,
                      color: AGENTS[agent as AgentKey].color,
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {msg.role === 'assistant' && (
                <div
                  className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-xs mt-0.5"
                  style={{
                    background: `${AGENTS[(msg.agentType as AgentKey) ?? 'orchestrator'].color}20`,
                    border: `1px solid ${AGENTS[(msg.agentType as AgentKey) ?? 'orchestrator'].color}40`,
                  }}
                >
                  {AGENTS[(msg.agentType as AgentKey) ?? 'orchestrator'].icon}
                </div>
              )}
              <div className={`flex flex-col max-w-[82%] ${msg.role === 'user' ? 'items-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <span className="text-xs mb-1 px-1" style={{ color: AGENTS[(msg.agentType as AgentKey) ?? 'orchestrator'].color }}>
                    {AGENTS[(msg.agentType as AgentKey) ?? 'orchestrator'].label}
                  </span>
                )}
                <div
                  className="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
                  style={
                    msg.role === 'user'
                      ? { background: '#3B82F6', color: '#fff', borderTopRightRadius: 4 }
                      : { background: '#0D1117', border: '1px solid #1E2435', color: '#CBD5E1', borderTopLeftRadius: 4 }
                  }
                >
                  {msg.streaming && !msg.content
                    ? <span className="inline-flex gap-1 items-center" style={{ color: '#475569' }}><Loader2 className="w-3 h-3 animate-spin" /> processando…</span>
                    : msg.content}
                  {msg.streaming && msg.content && (
                    <span className="inline-block w-0.5 h-3.5 ml-0.5 animate-pulse" style={{ background: '#60A5FA', verticalAlign: 'middle' }} />
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={chatBottomRef} />
        </div>

        {/* Input */}
        <div
          className="p-3 border-t"
          style={{ borderColor: '#1A2035', background: '#0D1117' }}
        >
          <form
            onSubmit={e => { e.preventDefault(); sendMessage(input); }}
            className="flex gap-2 items-end"
          >
            <div className="flex-1 relative">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={`Falar com ${AGENTS[selectedAgent].label}…`}
                disabled={isStreaming}
                className="w-full rounded-xl px-4 py-2.5 text-sm pr-10 outline-none focus:ring-1"
                style={{
                  background: '#141821',
                  border: '1px solid #1E2435',
                  color: '#E2E8F0',
                  '--tw-ring-color': AGENTS[selectedAgent].color,
                } as React.CSSProperties}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              />
            </div>
            {isStreaming ? (
              <button
                type="button"
                onClick={stopStream}
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
                style={{ background: '#EF444420', border: '1px solid #EF444440' }}
              >
                <X className="w-4 h-4" style={{ color: '#EF4444' }} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-30"
                style={{ background: AGENTS[selectedAgent].color }}
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers de ícone/cor para o log ─────────────────────────

function getActivityIcon(type: string) {
  const map: Record<string, string> = {
    user: '↑', routing: '⟳', routed: '→', thinking: '…',
    tool_call: '⚙', tool_result: '✓', delta: '▸', done: '●', error: '✗',
  };
  return map[type] ?? '·';
}

function getActivityColor(type: string) {
  const map: Record<string, string> = {
    user: '#60A5FA', routing: '#A855F7', routed: '#22C55E', thinking: '#475569',
    tool_call: '#F97316', tool_result: '#22C55E', delta: '#475569', done: '#14B8A6', error: '#EF4444',
  };
  return map[type] ?? '#475569';
}
