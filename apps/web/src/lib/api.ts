'use client';

export interface AgentConfig {
  agent_type: string;
  active: boolean;
  personalidade: string;
  instrucoes: string;
  restricoes: string;
  empresa: string;
  updated_at?: string;
  updated_by_name?: string;
}

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
    chatStream: (
      message: string,
      agentType: string | undefined,
      onEvent: (event: Record<string, unknown>) => void,
      channel = 'web',
    ): (() => void) => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sales_token') : null;
      const controller = new AbortController();
      (async () => {
        try {
          const res = await fetch(`${API_BASE}/agents/chat/stream`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ message, agent_type: agentType, channel }),
            signal: controller.signal,
          });
          if (!res.ok || !res.body) { onEvent({ type: 'error', message: 'Falha na conexão' }); return; }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() ?? '';
            for (const part of parts) {
              const line = part.trim();
              if (line.startsWith('data: ')) {
                try { onEvent(JSON.parse(line.slice(6))); } catch { /* ignore */ }
              }
            }
          }
        } catch (err) {
          if ((err as Error).name !== 'AbortError') onEvent({ type: 'error', message: String(err) });
        }
      })();
      return () => controller.abort();
    },
    status: () => apiFetch<Record<string, unknown>>('/agents/status'),
    conversations: () => apiFetch<unknown[]>('/agents/conversations'),
    insights: () => apiFetch<unknown[]>('/agents/insights'),
    markInsightRead: (id: string) =>
      apiFetch<{ success: boolean }>(`/agents/insights/${id}/read`, { method: 'PATCH' }),
    configs: {
      list: () => apiFetch<AgentConfig[]>('/agents/configs'),
      get: (type: string) => apiFetch<AgentConfig>(`/agents/configs/${type}`),
      update: (type: string, data: Partial<AgentConfig>) =>
        apiFetch<{ success: boolean }>(`/agents/configs/${type}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
    },
  },

  tasks: {
    list: (status?: string, date?: string) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (date) params.set('date', date);
      return apiFetch<unknown[]>(`/tasks?${params}`);
    },
    create: (data: Record<string, unknown>) =>
      apiFetch<unknown>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    complete: (id: string, note?: string) =>
      apiFetch<unknown>(`/tasks/${id}/complete`, {
        method: 'PATCH',
        body: JSON.stringify({ note }),
      }),
    update: (id: string, data: Record<string, unknown>) =>
      apiFetch<unknown>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
    suggestions: () => apiFetch<unknown[]>('/tasks/suggestions'),
    kpis: {
      today: () => apiFetch<unknown>('/tasks/kpis/today'),
      history: (days = 30, userId?: string) => {
        const params = new URLSearchParams({ days: String(days) });
        if (userId) params.set('user_id', userId);
        return apiFetch<unknown[]>(`/tasks/kpis/history?${params}`);
      },
      team: () => apiFetch<unknown[]>('/tasks/kpis/team'),
    },
    goals: {
      list: () => apiFetch<unknown[]>('/tasks/goals'),
      set: (data: Record<string, unknown>) =>
        apiFetch<unknown>('/tasks/goals', { method: 'POST', body: JSON.stringify(data) }),
    },
  },
};
