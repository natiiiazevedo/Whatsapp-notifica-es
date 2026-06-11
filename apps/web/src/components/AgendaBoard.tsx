'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import {
  Phone, Users2, Mail, MessageSquare, FileText,
  RefreshCw, MonitorPlay, PenLine, CheckCircle2,
  Clock, Plus, ChevronDown, Loader2, Circle, AlertCircle
} from 'lucide-react';
import type { Task, TaskPriority, TaskType } from '@sales/shared';

const TYPE_ICONS: Record<TaskType, React.ReactNode> = {
  call:      <Phone className="w-3.5 h-3.5" />,
  meeting:   <Users2 className="w-3.5 h-3.5" />,
  email:     <Mail className="w-3.5 h-3.5" />,
  whatsapp:  <MessageSquare className="w-3.5 h-3.5" />,
  proposal:  <FileText className="w-3.5 h-3.5" />,
  follow_up: <RefreshCw className="w-3.5 h-3.5" />,
  demo:      <MonitorPlay className="w-3.5 h-3.5" />,
  contract:  <PenLine className="w-3.5 h-3.5" />,
  other:     <Circle className="w-3.5 h-3.5" />,
};

const TYPE_LABELS: Record<TaskType, string> = {
  call: 'Ligação', meeting: 'Reunião', email: 'E-mail',
  whatsapp: 'WhatsApp', proposal: 'Proposta', follow_up: 'Follow-up',
  demo: 'Demo', contract: 'Contrato', other: 'Outro',
};

const PRIORITY_CONFIG: Record<TaskPriority, { color: string; bg: string; border: string; label: string }> = {
  urgent: { color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200',    label: '🔴 Urgente' },
  high:   { color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200', label: '🟠 Alta' },
  medium: { color: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-200', label: '🟡 Média' },
  low:    { color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-200',  label: '🟢 Baixa' },
};

interface SuggestionRow {
  negocio: string;
  contato?: string;
  telefone?: string;
  valor?: string;
  acao_sugerida: string;
  prioridade: TaskPriority;
  motivo: string;
}

interface TaskWithDeal extends Task {
  deal_title?: string;
  vendedor?: string;
}

// ─── Card de tarefa individual ────────────────────────────────

function TaskCard({ task, onComplete, onDelete }: {
  task: TaskWithDeal;
  onComplete: (id: string, note: string) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [completing, setCompleting] = useState(false);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [loading, setLoading] = useState(false);
  const p = PRIORITY_CONFIG[task.priority as TaskPriority];

  const handleComplete = async () => {
    setLoading(true);
    await onComplete(task.id, note);
    setLoading(false);
    setCompleting(false);
  };

  return (
    <div className={`rounded-xl border p-3.5 transition-all hover:shadow-sm ${p.bg} ${p.border}`}>
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => task.status === 'done' ? null : setCompleting(!completing)}
          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors
            ${task.status === 'done' ? 'bg-green-500 border-green-500 text-white' : `border-current ${p.color} hover:bg-white/50`}`}
        >
          {task.status === 'done' && <CheckCircle2 className="w-3 h-3" />}
        </button>

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={p.color}>{TYPE_ICONS[task.type as TaskType]}</span>
                <span className={`text-xs font-medium ${p.color}`}>{TYPE_LABELS[task.type as TaskType]}</span>
                {task.due_time && (
                  <span className="flex items-center gap-0.5 text-xs text-muted-foreground ml-1">
                    <Clock className="w-3 h-3" />
                    {task.due_time.slice(0,5)}
                  </span>
                )}
              </div>
              <p className={`text-sm font-medium leading-tight ${task.status === 'done' ? 'line-through text-muted-foreground' : 'text-gray-900'}`}>
                {task.title}
              </p>
            </div>
            <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium flex-shrink-0 ${p.color} bg-white/60`}>
              {p.label.split(' ')[0]}
            </span>
          </div>

          {/* Context */}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {task.contact_name && (
              <span className="text-xs text-muted-foreground">👤 {task.contact_name}</span>
            )}
            {task.company_name && (
              <span className="text-xs text-muted-foreground">🏢 {task.company_name}</span>
            )}
            {task.source_deal_value && (
              <span className="text-xs font-medium text-green-700">
                R$ {Number(task.source_deal_value).toLocaleString('pt-BR')}
              </span>
            )}
            {task.deal_title && (
              <span className="text-xs text-blue-600 truncate max-w-32">📋 {task.deal_title}</span>
            )}
          </div>

          {task.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
          )}

          {/* Completed note */}
          {task.status === 'done' && task.completed_note && (
            <p className="text-xs text-green-700 mt-1.5 bg-green-50 rounded px-2 py-1">
              ✅ {task.completed_note}
            </p>
          )}

          {/* Complete form */}
          {completing && task.status !== 'done' && (
            <div className="mt-2 space-y-2">
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="O que foi feito? (opcional)"
                rows={2}
                className="w-full text-xs border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleComplete}
                  disabled={loading}
                  className="flex items-center gap-1.5 text-xs bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Concluir
                </button>
                <button
                  onClick={() => setCompleting(false)}
                  className="text-xs text-muted-foreground hover:text-gray-700 px-2 py-1.5"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Card de sugestão da IA ───────────────────────────────────

function SuggestionCard({ suggestion, onAccept }: {
  suggestion: SuggestionRow;
  onAccept: (s: SuggestionRow) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const p = PRIORITY_CONFIG[suggestion.prioridade] ?? PRIORITY_CONFIG.medium;

  return (
    <div className={`rounded-xl border p-3 ${p.bg} ${p.border} opacity-80`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`text-xs font-medium ${p.color}`}>{p.label}</span>
          </div>
          <p className="text-xs font-medium text-gray-800">{suggestion.negocio}</p>
          {suggestion.contato && <p className="text-xs text-muted-foreground">👤 {suggestion.contato}</p>}
          {suggestion.valor && <p className="text-xs text-green-700 font-medium">{suggestion.valor}</p>}
          <p className="text-xs text-muted-foreground mt-1 italic">📌 {suggestion.motivo}</p>
        </div>
        <button
          onClick={async () => { setLoading(true); await onAccept(suggestion); setLoading(false); }}
          disabled={loading}
          className="flex items-center gap-1 text-xs bg-white border hover:bg-blue-50 hover:border-blue-300 text-gray-600 hover:text-blue-700 px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Adicionar
        </button>
      </div>
    </div>
  );
}

// ─── Formulário de nova tarefa ────────────────────────────────

function NewTaskForm({ onSave, onCancel }: {
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: '', type: 'call', priority: 'medium', contact_name: '', company_name: '',
    due_date: new Date().toISOString().split('T')[0], due_time: '', description: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setLoading(true);
    await onSave(form);
    setLoading(false);
  };

  return (
    <div className="bg-white border rounded-xl p-4 space-y-3 shadow-sm">
      <h4 className="text-sm font-semibold">Nova Tarefa</h4>
      <input
        type="text"
        placeholder="O que precisa ser feito?"
        value={form.title}
        onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoFocus
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={form.type}
          onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select
          value={form.priority}
          onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="urgent">🔴 Urgente</option>
          <option value="high">🟠 Alta</option>
          <option value="medium">🟡 Média</option>
          <option value="low">🟢 Baixa</option>
        </select>
        <input
          type="text"
          placeholder="Contato"
          value={form.contact_name}
          onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="text"
          placeholder="Empresa"
          value={form.company_name}
          onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="date"
          value={form.due_date}
          onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="time"
          value={form.due_time}
          onChange={e => setForm(f => ({ ...f, due_time: e.target.value }))}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <textarea
        placeholder="Objetivo ou observações (opcional)"
        value={form.description}
        onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        rows={2}
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={loading || !form.title.trim()}
          className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Criar Tarefa
        </button>
        <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-gray-700 px-3 py-2">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────

export function AgendaBoard({ userId }: { userId: string }) {
  const [tasks, setTasks] = useState<TaskWithDeal[]>([]);
  const [doneTasks, setDoneTasks] = useState<TaskWithDeal[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [pending, done, sugs] = await Promise.all([
      api.tasks.list() as Promise<TaskWithDeal[]>,
      api.tasks.list('done', new Date().toISOString().split('T')[0]) as Promise<TaskWithDeal[]>,
      api.tasks.suggestions() as Promise<SuggestionRow[]>,
    ]);
    setTasks(pending);
    setDoneTasks(done);
    setSuggestions(sugs.slice(0, 8));
    setLoading(false);
  };

  // Load on mount
  useState(() => { loadData(); });

  const handleComplete = async (id: string, note: string) => {
    await api.tasks.complete(id, note);
    await loadData();
  };

  const handleDelete = async (id: string) => {
    await api.tasks.delete(id);
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const handleCreate = async (data: Record<string, unknown>) => {
    await api.tasks.create(data);
    setShowNewForm(false);
    await loadData();
  };

  const handleAcceptSuggestion = async (s: SuggestionRow) => {
    await api.tasks.create({
      title: `${s.acao_sugerida}: ${s.negocio}`,
      type: 'call',
      priority: s.prioridade,
      contact_name: s.contato,
      description: s.motivo,
      due_date: new Date().toISOString().split('T')[0],
    });
    setSuggestions(prev => prev.filter(sg => sg.negocio !== s.negocio));
    await loadData();
  };

  const urgentCount = tasks.filter(t => t.priority === 'urgent').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Agenda do Dia</h2>
          {urgentCount > 0 && (
            <span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
              <AlertCircle className="w-3 h-3" />
              {urgentCount} urgente{urgentCount > 1 ? 's' : ''}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {tasks.length} pendente{tasks.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-muted-foreground"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowNewForm(true)}
            className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nova Tarefa
          </button>
        </div>
      </div>

      {showNewForm && (
        <NewTaskForm onSave={handleCreate} onCancel={() => setShowNewForm(false)} />
      )}

      {/* Tarefas pendentes */}
      {tasks.length > 0 ? (
        <div className="space-y-2">
          {tasks
            .sort((a, b) => {
              const order = { urgent: 0, high: 1, medium: 2, low: 3 };
              return (order[a.priority as TaskPriority] ?? 4) - (order[b.priority as TaskPriority] ?? 4);
            })
            .map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onComplete={handleComplete}
                onDelete={handleDelete}
              />
            ))
          }
        </div>
      ) : !loading && (
        <div className="bg-white rounded-xl border p-6 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
          Nenhuma tarefa pendente. 🎉
        </div>
      )}

      {/* Sugestões da IA */}
      {suggestions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <span className="w-4 h-4 bg-blue-100 text-blue-600 rounded text-xs flex items-center justify-center">IA</span>
            Sugeridos pelo agente
          </h3>
          {suggestions.map((s, i) => (
            <SuggestionCard key={i} suggestion={s} onAccept={handleAcceptSuggestion} />
          ))}
        </div>
      )}

      {/* Tarefas concluídas hoje */}
      {doneTasks.length > 0 && (
        <div>
          <button
            onClick={() => setShowDone(!showDone)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-gray-700 w-full py-1"
          >
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="font-medium">{doneTasks.length} concluída{doneTasks.length !== 1 ? 's' : ''} hoje</span>
            <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${showDone ? 'rotate-180' : ''}`} />
          </button>
          {showDone && (
            <div className="space-y-2 mt-2">
              {doneTasks.map(task => (
                <TaskCard key={task.id} task={task} onComplete={async () => {}} onDelete={() => {}} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
