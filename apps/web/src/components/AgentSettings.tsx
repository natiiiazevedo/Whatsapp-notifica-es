'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import type { AgentConfig } from '@/lib/api';
import {
  Bot, Settings, ChevronRight, Save, X, ToggleLeft, ToggleRight,
  Calendar, MessageSquare, TrendingUp, Briefcase, Heart, Users,
  Trophy, AlertTriangle, BarChart3, Loader2, CheckCircle2,
} from 'lucide-react';

const AGENT_META: Record<string, { label: string; description: string; icon: React.ReactNode; color: string }> = {
  orchestrator: {
    label: 'Orquestrador',
    description: 'Analisa e roteia mensagens para o agente correto',
    icon: <Bot className="w-5 h-5" />,
    color: 'bg-yellow-500',
  },
  agenda: {
    label: 'Agenda',
    description: 'Gerencia tarefas, compromissos e planejamento diário',
    icon: <Calendar className="w-5 h-5" />,
    color: 'bg-teal-500',
  },
  feedback: {
    label: 'Feedback',
    description: 'Transforma métricas em orientações motivadoras',
    icon: <MessageSquare className="w-5 h-5" />,
    color: 'bg-purple-500',
  },
  deal: {
    label: 'Negócios',
    description: 'Avança negociações e ajuda a superar objeções',
    icon: <Briefcase className="w-5 h-5" />,
    color: 'bg-orange-500',
  },
  postsales: {
    label: 'Pós-venda',
    description: 'Garante satisfação e fidelização após o fechamento',
    icon: <Heart className="w-5 h-5" />,
    color: 'bg-pink-500',
  },
  carteira: {
    label: 'Carteira',
    description: 'Monitora saúde da carteira e previne churn',
    icon: <TrendingUp className="w-5 h-5" />,
    color: 'bg-green-500',
  },
  gamification: {
    label: 'Gamificação',
    description: 'Cria engajamento com rankings e desafios',
    icon: <Trophy className="w-5 h-5" />,
    color: 'bg-yellow-400',
  },
  inactivity: {
    label: 'Inatividade',
    description: 'Monitora leads sem interação e sugere reengajamento',
    icon: <AlertTriangle className="w-5 h-5" />,
    color: 'bg-red-500',
  },
  manager: {
    label: 'Gerencial',
    description: 'Visão macro da operação e análise de equipe',
    icon: <BarChart3 className="w-5 h-5" />,
    color: 'bg-blue-500',
  },
};

type EditorTab = 'personalidade' | 'instrucoes' | 'restricoes' | 'empresa';

const TAB_CONFIG: { key: EditorTab; label: string; placeholder: string; hint: string }[] = [
  {
    key: 'personalidade',
    label: 'Personalidade',
    placeholder: 'Ex: Você é um agente comercial experiente, direto e motivador. Usa linguagem profissional mas acessível...',
    hint: 'Define o tom, estilo e caráter do agente. Como ele se apresenta e se comunica.',
  },
  {
    key: 'instrucoes',
    label: 'Instruções',
    placeholder: 'Ex: Sempre verifique o histórico do cliente antes de responder. Sugira próximas ações em cada resposta...',
    hint: 'O que o agente deve fazer, como agir e quais processos seguir.',
  },
  {
    key: 'restricoes',
    label: 'Restrições',
    placeholder: 'Ex: Não prometa descontos sem aprovação. Nunca compartilhe dados de outros clientes...',
    hint: 'O que o agente NÃO deve fazer. Limites e regras de compliance.',
  },
  {
    key: 'empresa',
    label: 'Contexto da Empresa',
    placeholder: 'Ex: Somos uma empresa de SaaS B2B com foco em PMEs. Nosso produto principal é... Nossos diferenciais são...',
    hint: 'Informações sobre sua empresa, produto e mercado que o agente deve conhecer.',
  },
];

interface AgentEditorProps {
  config: AgentConfig;
  isManager: boolean;
  onClose: () => void;
  onSaved: (updated: AgentConfig) => void;
}

function AgentEditor({ config, isManager, onClose, onSaved }: AgentEditorProps) {
  const meta = AGENT_META[config.agent_type] ?? AGENT_META.orchestrator;
  const [tab, setTab] = useState<EditorTab>('personalidade');
  const [form, setForm] = useState({
    personalidade: config.personalidade,
    instrucoes: config.instrucoes,
    restricoes: config.restricoes,
    empresa: config.empresa,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const currentTab = TAB_CONFIG.find(t => t.key === tab)!;
  const charCount = form[tab].length;
  const maxChars = tab === 'restricoes' || tab === 'empresa' ? 2000 : 5000;

  const handleSave = async () => {
    if (!isManager) return;
    setSaving(true);
    try {
      await api.agents.configs.update(config.agent_type, form);
      setSaved(true);
      onSaved({ ...config, ...form });
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b">
          <div className={`w-10 h-10 rounded-xl ${meta.color} flex items-center justify-center text-white flex-shrink-0`}>
            {meta.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-base">{meta.label}</h2>
            <p className="text-xs text-muted-foreground truncate">{meta.description}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 pb-0 border-b">
          {TAB_CONFIG.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                tab === t.key
                  ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Editor area */}
        <div className="flex-1 overflow-auto px-6 py-4 space-y-3">
          <p className="text-xs text-muted-foreground bg-gray-50 border rounded-lg px-3 py-2">
            {currentTab.hint}
          </p>
          <textarea
            className="w-full h-52 border rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono leading-relaxed disabled:bg-gray-50 disabled:text-gray-500"
            placeholder={currentTab.placeholder}
            value={form[tab]}
            onChange={e => setForm(prev => ({ ...prev, [tab]: e.target.value }))}
            disabled={!isManager}
            maxLength={maxChars}
          />
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>{isManager ? 'Edite o texto acima e clique em Salvar' : 'Apenas gestores podem editar configurações'}</span>
            <span className={charCount > maxChars * 0.9 ? 'text-orange-500' : ''}>
              {charCount}/{maxChars}
            </span>
          </div>
        </div>

        {/* Footer */}
        {isManager && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : saved ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saved ? 'Salvo!' : 'Salvar alterações'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface AgentSettingsProps {
  isManager: boolean;
}

export function AgentSettings({ isManager }: AgentSettingsProps) {
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AgentConfig | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.agents.configs.list();
      setConfigs(data);
    } catch {
      // use defaults from API
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (cfg: AgentConfig) => {
    if (!isManager) return;
    setToggling(cfg.agent_type);
    try {
      await api.agents.configs.update(cfg.agent_type, { active: !cfg.active });
      setConfigs(prev =>
        prev.map(c => c.agent_type === cfg.agent_type ? { ...c, active: !c.active } : c)
      );
    } finally {
      setToggling(null);
    }
  };

  const handleSaved = (updated: AgentConfig) => {
    setConfigs(prev =>
      prev.map(c => c.agent_type === updated.agent_type ? updated : c)
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  const orderedTypes = ['orchestrator', 'agenda', 'deal', 'feedback', 'postsales', 'carteira', 'gamification', 'inactivity', 'manager'];
  const sorted = orderedTypes
    .map(t => configs.find(c => c.agent_type === t))
    .filter(Boolean) as AgentConfig[];

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4">
        <div className="flex items-start gap-3">
          <Settings className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-900">Configuração de Agentes IA</p>
            <p className="text-xs text-blue-700 mt-0.5">
              {isManager
                ? 'Personalize a personalidade, instruções e restrições de cada agente. As alterações afetam todos os usuários da empresa.'
                : 'Visualize as configurações dos agentes. Apenas gestores podem editar.'}
            </p>
          </div>
        </div>
      </div>

      {/* Agent list */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agente</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Função</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Última edição</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((cfg, i) => {
              const meta = AGENT_META[cfg.agent_type] ?? AGENT_META.orchestrator;
              const isTogglingThis = toggling === cfg.agent_type;
              return (
                <tr key={cfg.agent_type} className={`border-b last:border-0 hover:bg-gray-50 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/40'}`}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl ${meta.color} flex items-center justify-center text-white flex-shrink-0`}>
                        {meta.icon}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{meta.label}</p>
                        <p className="text-xs text-muted-foreground md:hidden">{meta.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell">
                    {meta.description}
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <button
                      onClick={() => handleToggle(cfg)}
                      disabled={!isManager || isTogglingThis}
                      className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed"
                      title={isManager ? (cfg.active ? 'Clique para desativar' : 'Clique para ativar') : 'Apenas gestores podem alterar'}
                    >
                      {isTogglingThis ? (
                        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                      ) : cfg.active ? (
                        <ToggleRight className="w-6 h-6 text-green-500" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-gray-300" />
                      )}
                      <span className={`text-xs font-medium ${cfg.active ? 'text-green-600' : 'text-gray-400'}`}>
                        {cfg.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </button>
                  </td>
                  <td className="px-5 py-3.5 hidden lg:table-cell">
                    {cfg.updated_at ? (
                      <div>
                        <p className="text-xs text-gray-700">
                          {new Date(cfg.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                        {cfg.updated_by_name && (
                          <p className="text-xs text-muted-foreground">{cfg.updated_by_name}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Padrão do sistema</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => setEditing(cfg)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ml-auto ${
                        isManager
                          ? 'bg-gray-100 hover:bg-blue-50 hover:text-blue-700 text-gray-600'
                          : 'text-gray-400 bg-gray-50 cursor-default'
                      }`}
                    >
                      {isManager ? 'Configurar' : 'Visualizar'}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Editor modal */}
      {editing && (
        <AgentEditor
          config={editing}
          isManager={isManager}
          onClose={() => setEditing(null)}
          onSaved={updated => { handleSaved(updated); setEditing(updated); }}
        />
      )}
    </div>
  );
}
