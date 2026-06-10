'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AgentChat } from '@/components/AgentChat';
import { TeamMetricsGrid, RevenueChart, RankingTable } from '@/components/TeamMetrics';
import { DealCard } from '@/components/DealCard';
import type { Deal } from '@sales/shared';

export default function ManagerDashboard() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);
  const [ranking, setRanking] = useState<unknown[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'pipeline' | 'chat'>('overview');

  useEffect(() => {
    Promise.all([
      api.dashboard.overview(),
      api.dashboard.metricsHistory(30),
      api.dashboard.ranking(),
    ]).then(([overview, hist, rank]) => {
      setData(overview as Record<string, unknown>);
      setHistory(hist as unknown[]);
      setRanking(rank as unknown[]);
    });
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Gestão da Equipe</h1>
        <div className="flex gap-2">
          {(['overview', 'pipeline', 'chat'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === t ? 'bg-blue-600 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'overview' ? 'Visão Geral' : t === 'pipeline' ? 'Pipeline' : 'Chat IA'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && data && (
        <div className="space-y-6">
          <TeamMetricsGrid metrics={data.metrics as Record<string, unknown>} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RevenueChart data={history as Parameters<typeof RevenueChart>[0]['data']} />
            <RankingTable data={ranking as Parameters<typeof RankingTable>[0]['data']} />
          </div>
        </div>
      )}

      {activeTab === 'pipeline' && data && (
        <div className="space-y-4">
          <h2 className="font-semibold">Negócios Prioritários da Equipe</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(data.deals_prioritarios as Array<Deal & { vendedor?: string }>)?.map(deal => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        </div>
      )}

      {activeTab === 'chat' && (
        <div className="max-w-2xl h-[600px]">
          <AgentChat agentType="manager" userRole="manager" />
        </div>
      )}
    </div>
  );
}
