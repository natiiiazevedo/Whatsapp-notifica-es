'use client';

import { TrendingUp, TrendingDown, AlertTriangle, Users, DollarSign, Target } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon: React.ReactNode;
  color?: 'blue' | 'green' | 'red' | 'yellow';
}

function MetricCard({ label, value, subtext, trend, icon, color = 'blue' }: MetricCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    yellow: 'bg-yellow-50 text-yellow-600',
  };

  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClasses[color]}`}>
          {icon}
        </div>
        {trend && (
          <span className={`text-xs flex items-center gap-1 ${trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-400'}`}>
            {trend === 'up' ? <TrendingUp className="w-3 h-3" /> : trend === 'down' ? <TrendingDown className="w-3 h-3" /> : null}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-muted-foreground mt-0.5">{label}</p>
      {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
    </div>
  );
}

export function TeamMetricsGrid({ metrics }: { metrics: Record<string, unknown> }) {
  if (!metrics) return null;

  const formatCurrency = (v: unknown) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(v) ?? 0);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard
        label="Pipeline Total"
        value={formatCurrency(metrics.pipeline_total)}
        icon={<DollarSign className="w-5 h-5" />}
        color="blue"
      />
      <MetricCard
        label="Receita do Mês"
        value={formatCurrency(metrics.receita_mes)}
        subtext={`${metrics.fechamentos_mes ?? 0} fechamentos`}
        icon={<Target className="w-5 h-5" />}
        color="green"
        trend="up"
      />
      <MetricCard
        label="Deals em Risco"
        value={String(metrics.deals_em_risco ?? 0)}
        subtext="sem atividade há 3+ dias"
        icon={<AlertTriangle className="w-5 h-5" />}
        color="red"
        trend="down"
      />
      <MetricCard
        label="Membros Ativos"
        value={String(metrics.membros_ativos ?? metrics.deals_ativos ?? 0)}
        icon={<Users className="w-5 h-5" />}
        color="yellow"
      />
    </div>
  );
}

export function RevenueChart({ data }: { data: Array<{ date: string; revenue_won: number; deals_won: number }> }) {
  if (!data?.length) return (
    <div className="bg-white rounded-xl border p-5">
      <h3 className="font-semibold mb-4">Receita por Dia</h3>
      <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
        Sem dados no período
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-xl border p-5">
      <h3 className="font-semibold mb-4">Receita por Dia</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => new Date(d).getDate().toString()} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
          <Tooltip
            formatter={(v) => [new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v)), 'Receita']}
            labelFormatter={l => new Date(l).toLocaleDateString('pt-BR')}
          />
          <Bar dataKey="revenue_won" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RankingTable({ data }: { data: Array<{
  id: string; name: string; avatar_url?: string;
  points: number; level_name: string; streak_days: number; posicao: number;
}> }) {
  if (!data?.length) return null;

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h3 className="font-semibold">Ranking da Equipe</h3>
      </div>
      <div className="divide-y">
        {data.map((member, i) => (
          <div key={member.id} className="flex items-center gap-4 px-5 py-3">
            <span className={`w-6 text-center font-bold text-sm ${i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-orange-400' : 'text-muted-foreground'}`}>
              {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}°`}
            </span>
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-medium flex-shrink-0">
              {member.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{member.name}</p>
              <p className="text-xs text-muted-foreground">{member.level_name}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold">{member.points.toLocaleString('pt-BR')} pts</p>
              {member.streak_days > 0 && (
                <p className="text-xs text-orange-500">🔥 {member.streak_days} dias</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
