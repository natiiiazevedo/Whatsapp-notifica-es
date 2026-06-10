'use client';

import type { Deal } from '@sales/shared';
import { AlertCircle, Clock, TrendingUp, Phone } from 'lucide-react';

const STAGE_LABELS: Record<string, string> = {
  new: 'Novo',
  qualification: 'Qualificação',
  proposal: 'Proposta',
  negotiation: 'Negociação',
  won: 'Ganho',
  lost: 'Perdido',
  paused: 'Pausado',
};

const STAGE_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-700',
  qualification: 'bg-blue-100 text-blue-700',
  proposal: 'bg-yellow-100 text-yellow-700',
  negotiation: 'bg-orange-100 text-orange-700',
  won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
  paused: 'bg-purple-100 text-purple-700',
};

export function DealCard({ deal, onClick }: {
  deal: Deal & { vendedor?: string };
  onClick?: () => void;
}) {
  const daysInactive = deal.days_without_activity ?? 0;
  const isAtRisk = daysInactive >= 3;
  const isCritical = daysInactive >= 7;
  const isOverdue = deal.expected_close_date && new Date(deal.expected_close_date) < new Date();

  return (
    <div
      onClick={onClick}
      className={`rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md hover:border-blue-300
        ${isCritical ? 'border-red-200 bg-red-50/50' : isAtRisk ? 'border-yellow-200 bg-yellow-50/50' : 'bg-white'}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-medium text-sm text-gray-900 leading-tight flex-1">{deal.title}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STAGE_COLORS[deal.stage]}`}>
          {STAGE_LABELS[deal.stage]}
        </span>
      </div>

      {deal.contact_name && (
        <p className="text-xs text-muted-foreground mb-2">{deal.contact_name}</p>
      )}

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3">
          {deal.value && (
            <span className="text-sm font-semibold text-gray-900">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(deal.value)}
            </span>
          )}
          {deal.probability > 0 && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <TrendingUp className="w-3 h-3" />
              {deal.probability}%
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isOverdue && (
            <span className="flex items-center gap-1 text-xs text-red-600">
              <AlertCircle className="w-3 h-3" />
              Prazo vencido
            </span>
          )}
          {daysInactive > 0 && (
            <span className={`flex items-center gap-1 text-xs ${isCritical ? 'text-red-600' : isAtRisk ? 'text-yellow-600' : 'text-gray-400'}`}>
              <Clock className="w-3 h-3" />
              {daysInactive}d sem contato
            </span>
          )}
        </div>
      </div>

      {deal.vendedor && (
        <p className="text-xs text-muted-foreground mt-2 border-t pt-2">
          Vendedor: {deal.vendedor}
        </p>
      )}
    </div>
  );
}
