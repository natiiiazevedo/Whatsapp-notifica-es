'use client';

import { Phone, Users2, Trophy, Briefcase, Building2, TrendingUp, Target } from 'lucide-react';
import { RadialBarChart, RadialBar, ResponsiveContainer, Tooltip } from 'recharts';

interface KPIData {
  calls_done: number;
  meetings_done: number;
  deals_won: number;
  revenue_won: number;
  deals_worked: number;
  companies_reached: number;
  active_deals: number;
  pipeline_value: number;
  goal_calls_per_day?: number;
  goal_meetings_per_day?: number;
  goal_companies_per_day?: number;
}

interface TeamKPIRow extends KPIData {
  id: string;
  name: string;
  avatar_url?: string;
  pct_ligacoes?: number;
  pct_reunioes?: number;
}

function KPIRing({ value, goal, color, size = 56 }: {
  value: number; goal?: number; color: string; size?: number;
}) {
  const pct = goal ? Math.min(100, Math.round((value / goal) * 100)) : null;
  const data = [{ value: pct ?? 100, fill: color }];
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="70%" outerRadius="100%"
          data={data} startAngle={90} endAngle={-270}
        >
          <RadialBar dataKey="value" background={{ fill: '#f1f5f9' }} cornerRadius={4} />
        </RadialBarChart>
      </ResponsiveContainer>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

interface KPICardProps {
  label: string;
  value: number;
  goal?: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  format?: (v: number) => string;
}

function KPICard({ label, value, goal, icon, color, bgColor, format }: KPICardProps) {
  const pct = goal ? Math.min(100, Math.round((value / goal) * 100)) : null;
  const display = format ? format(value) : String(value);

  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${bgColor}`}>
          <span className={color}>{icon}</span>
        </div>
        {pct !== null && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
            ${pct >= 100 ? 'bg-green-100 text-green-700' : pct >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>
            {pct}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900">{display}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      {goal && (
        <div className="mt-2">
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${pct! >= 100 ? 'bg-green-500' : pct! >= 60 ? 'bg-yellow-400' : 'bg-red-400'}`}
              style={{ width: `${Math.min(100, pct!)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">Meta: {goal}</p>
        </div>
      )}
    </div>
  );
}

// ─── Painel de KPIs para VENDEDOR ────────────────────────────

export function SalespersonKPIs({ kpis }: { kpis: KPIData }) {
  const currency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Seu dia hoje
        </h2>
        <span className="text-xs text-muted-foreground">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <KPICard
          label="Ligações"
          value={kpis.calls_done}
          goal={kpis.goal_calls_per_day}
          icon={<Phone className="w-4 h-4" />}
          color="text-blue-600" bgColor="bg-blue-50"
        />
        <KPICard
          label="Reuniões"
          value={kpis.meetings_done}
          goal={kpis.goal_meetings_per_day}
          icon={<Users2 className="w-4 h-4" />}
          color="text-violet-600" bgColor="bg-violet-50"
        />
        <KPICard
          label="Empresas Atingidas"
          value={kpis.companies_reached}
          goal={kpis.goal_companies_per_day}
          icon={<Building2 className="w-4 h-4" />}
          color="text-orange-600" bgColor="bg-orange-50"
        />
        <KPICard
          label="Negócios Tratados"
          value={kpis.deals_worked}
          icon={<Briefcase className="w-4 h-4" />}
          color="text-teal-600" bgColor="bg-teal-50"
        />
        <KPICard
          label="Vendas Fechadas"
          value={kpis.deals_won}
          icon={<Trophy className="w-4 h-4" />}
          color="text-yellow-600" bgColor="bg-yellow-50"
        />
        <KPICard
          label="Receita Hoje"
          value={kpis.revenue_won}
          icon={<TrendingUp className="w-4 h-4" />}
          color="text-green-600" bgColor="bg-green-50"
          format={currency}
        />
      </div>

      {/* Pipeline snapshot */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-blue-200 font-medium">Pipeline Ativo</p>
            <p className="text-xl font-bold">{currency(kpis.pipeline_value)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-blue-200 font-medium">Negócios</p>
            <p className="text-xl font-bold">{kpis.active_deals}</p>
          </div>
          <Target className="w-10 h-10 text-blue-300 opacity-50" />
        </div>
      </div>
    </div>
  );
}

// ─── Painel de KPIs para GESTOR (todos da equipe) ────────────

export function TeamKPIsTable({ team }: { team: TeamKPIRow[] }) {
  if (!team?.length) return null;

  const currency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v ?? 0);

  // Totais
  const totals = team.reduce((acc, m) => ({
    calls: acc.calls + (m.calls_done ?? 0),
    meetings: acc.meetings + (m.meetings_done ?? 0),
    deals_won: acc.deals_won + (m.deals_won ?? 0),
    revenue: acc.revenue + (m.revenue_won ?? 0),
    deals_worked: acc.deals_worked + (m.deals_worked ?? 0),
    companies: acc.companies + (m.companies_reached ?? 0),
  }), { calls: 0, meetings: 0, deals_won: 0, revenue: 0, deals_worked: 0, companies: 0 });

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      {/* Header com totais */}
      <div className="px-5 py-4 border-b bg-gray-50">
        <h3 className="font-semibold mb-3">KPIs da Equipe — Hoje</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {[
            { label: 'Ligações', value: totals.calls, icon: '📞' },
            { label: 'Reuniões', value: totals.meetings, icon: '🤝' },
            { label: 'Vendas', value: totals.deals_won, icon: '🏆' },
            { label: 'Negócios', value: totals.deals_worked, icon: '💼' },
            { label: 'Empresas', value: totals.companies, icon: '🏢' },
            { label: 'Receita', value: currency(totals.revenue), icon: '💰' },
          ].map(item => (
            <div key={item.label} className="text-center">
              <p className="text-lg">{item.icon}</p>
              <p className="text-base font-bold text-gray-900">{item.value}</p>
              <p className="text-xs text-muted-foreground">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabela por vendedor */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Vendedor</th>
              <th className="text-center px-3 py-2.5 font-medium text-muted-foreground">📞 Lig.</th>
              <th className="text-center px-3 py-2.5 font-medium text-muted-foreground">🤝 Reun.</th>
              <th className="text-center px-3 py-2.5 font-medium text-muted-foreground">🏆 Vendas</th>
              <th className="text-center px-3 py-2.5 font-medium text-muted-foreground">💼 Neg.</th>
              <th className="text-center px-3 py-2.5 font-medium text-muted-foreground">🏢 Emp.</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">💰 Receita</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {team.map(member => (
              <tr key={member.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-medium flex-shrink-0">
                      {member.name.charAt(0)}
                    </div>
                    <span className="font-medium truncate">{member.name}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-center">
                  <GoalCell value={member.calls_done ?? 0} goal={member.goal_calls_per_day} />
                </td>
                <td className="px-3 py-3 text-center">
                  <GoalCell value={member.meetings_done ?? 0} goal={member.goal_meetings_per_day} />
                </td>
                <td className="px-3 py-3 text-center">
                  <span className={`font-semibold ${(member.deals_won ?? 0) > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                    {member.deals_won ?? 0}
                  </span>
                </td>
                <td className="px-3 py-3 text-center text-gray-600">{member.deals_worked ?? 0}</td>
                <td className="px-3 py-3 text-center text-gray-600">{member.companies_reached ?? 0}</td>
                <td className="px-4 py-3 text-right font-semibold text-green-700">
                  {(member.revenue_won ?? 0) > 0 ? currency(member.revenue_won) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GoalCell({ value, goal }: { value: number; goal?: number }) {
  if (!goal) return <span className="text-gray-600">{value}</span>;
  const pct = Math.round((value / goal) * 100);
  const color = pct >= 100 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-red-500';
  return (
    <span className={`font-semibold ${color}`}>
      {value}<span className="text-xs font-normal text-muted-foreground">/{goal}</span>
    </span>
  );
}
