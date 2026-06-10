'use client';

const API_BASE = '/api';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sales_token');
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      apiFetch<{ token: string; user: Record<string, unknown> }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: () => apiFetch<Record<string, unknown>>('/auth/me'),
  },

  dashboard: {
    overview: () => apiFetch<Record<string, unknown>>('/dashboard/overview'),
    metricsHistory: (days = 30) => apiFetch<unknown[]>(`/dashboard/metrics/history?days=${days}`),
    ranking: () => apiFetch<unknown[]>('/dashboard/ranking'),
  },

  agents: {
    chat: (message: string, agentType?: string, channel = 'web') =>
      apiFetch<{ message: string; agent_type: string }>('/agents/chat', {
        method: 'POST',
        body: JSON.stringify({ message, agent_type: agentType, channel }),
      }),
    conversations: () => apiFetch<unknown[]>('/agents/conversations'),
    insights: () => apiFetch<unknown[]>('/agents/insights'),
    markInsightRead: (id: string) =>
      apiFetch<{ success: boolean }>(`/agents/insights/${id}/read`, { method: 'PATCH' }),
  },
};
