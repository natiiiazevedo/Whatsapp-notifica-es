'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AgentChat } from '@/components/AgentChat';
import { DealCard } from '@/components/DealCard';
import { TeamMetricsGrid, RevenueChart, RankingTable } from '@/components/TeamMetrics';
import { Bell, LayoutDashboard, MessageSquare, Trophy, LogOut, Settings, AlertCircle } from 'lucide-react';
import type { Deal } from '@sales/shared';

interface DashboardData {
  metrics: Record<string, unknown>;
  deals_prioritarios: Array<Deal & { vendedor?: string }>;
  insights_nao_lidos: Array<{
    id: string; title: string; content: string; priority: string; insight_type: string;
  }>;
  gamificacao: Record<string, unknown> | Array<Record<string, unknown>>;
}

type Tab = 'overview' | 'chat' | 'ranking';

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-600 bg-red-50 border-red-200',
  high: 'text-orange-600 bg-orange-50 border-orange-200',
  medium: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  low: 'text-green-600 bg-green-50 border-green-200',
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);
  const [ranking, setRanking] = useState<unknown[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [user, setUser] = useState<{ name: string; role: string; email: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('sales_token');
    if (!token) { window.location.href = '/'; return; }

    Promise.all([
      api.dashboard.overview(),
      api.dashboard.metricsHistory(30),
      api.dashboard.ranking(),
      api.auth.me(),
    ]).then(([overview, history, ranking, me]) => {
      setData(overview as DashboardData);
      setHistory(history as unknown[]);
      setRanking(ranking as unknown[]);
      setUser(me as { name: string; role: string; email: string });
    }).catch(() => {
      localStorage.removeItem('sales_token');
      window.location.href = '/';
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  const isManager = user?.role !== 'salesperson';

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r flex flex-col">
        <div className="p-5 border-b">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">AI</div>
            <span className="font-semibold text-sm">Sales Platform</span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {[
            { key: 'overview', label: 'Painel', icon: <LayoutDashboard className="w-4 h-4" /> },
            { key: 'chat', label: 'Chat com IA', icon: <MessageSquare className="w-4 h-4" /> },
            { key: 'ranking', label: 'Ranking', icon: <Trophy className="w-4 h-4" /> },
          ].map(item => (
            <button
              key={item.key}
              onClick={() => setTab(item.key as Tab)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                tab === item.key
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-medium">
              {user?.name?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{user?.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
            </div>
            <button onClick={() => { localStorage.removeItem('sales_token'); window.location.href = '/'; }}>
              <LogOut className="w-4 h-4 text-gray-400 hover:text-gray-600" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {tab === 'overview' && (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold">
                  Bom dia, {user?.name?.split(' ')[0]}!
                </h1>
                <p className="text-sm text-muted-foreground">
                  {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
              </div>
              <div className="relative">
                <Bell className="w-5 h-5 text-gray-500" />
                {(data?.insights_nao_lidos?.length ?? 0) > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center">
                    {data?.insights_nao_lidos?.length}
                  </span>
                )}
              </div>
            </div>

            {/* Métricas */}
            {data?.metrics && <TeamMetricsGrid metrics={data.metrics} />}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Negócios prioritários */}
              <div className="lg:col-span-2 space-y-3">
                <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Negócios Prioritários
                </h2>
                {data?.deals_prioritarios?.length ? (
                  data.deals_prioritarios.slice(0, 6).map(deal => (
                    <DealCard key={deal.id} deal={deal} />
                  ))
                ) : (
                  <div className="bg-white rounded-xl border p-8 text-center text-sm text-muted-foreground">
                    Nenhum negócio ativo no momento
                  </div>
                )}
              </div>

              {/* Insights + Chat rápido */}
              <div className="space-y-4">
                {/* Insights */}
                {(data?.insights_nao_lidos?.length ?? 0) > 0 && (
                  <div>
                    <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">
                      Insights IA
                    </h2>
                    <div className="space-y-2">
                      {data!.insights_nao_lidos.map(insight => (
                        <div key={insight.id} className={`rounded-xl border p-3 text-xs ${PRIORITY_COLORS[insight.priority]}`}>
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="font-medium">{insight.title}</p>
                              <p className="mt-0.5 opacity-80 line-clamp-2">{insight.content}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mini chat */}
                <div className="h-96">
                  <AgentChat userRole={user?.role} />
                </div>
              </div>
            </div>

            {/* Gráfico histórico */}
            <RevenueChart data={history as Array<{ date: string; revenue_won: number; deals_won: number }>} />
          </div>
        )}

        {tab === 'chat' && (
          <div className="p-6 h-[calc(100vh-2rem)]">
            <div className="max-w-2xl mx-auto h-full">
              <AgentChat userRole={user?.role} />
            </div>
          </div>
        )}

        {tab === 'ranking' && (
          <div className="p-6 space-y-6">
            <h1 className="text-xl font-bold">Ranking da Equipe</h1>
            <RankingTable data={ranking as Parameters<typeof RankingTable>[0]['data']} />
          </div>
        )}
      </main>
    </div>
  );
}
