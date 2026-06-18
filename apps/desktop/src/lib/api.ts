const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4000';

export const apiBaseUrl = API_BASE_URL;

let cachedApiToken: string | null | undefined;

const toReadableError = (error: unknown) => {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return 'Failed to fetch local API. The service may still be starting or reconnecting.';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unexpected API request error.';
};

const getApiToken = async () => {
  if (cachedApiToken !== undefined) {
    return cachedApiToken;
  }

  if (!window.electronAPI?.getApiSecurityConfig) {
    cachedApiToken = null;
    return cachedApiToken;
  }

  const config = await window.electronAPI.getApiSecurityConfig();
  cachedApiToken = config.apiToken;
  return cachedApiToken;
};

const buildHeaders = async (init?: RequestInit) => {
  const token = await getApiToken();
  const headers = new Headers(init?.headers ?? undefined);
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return headers;
};

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: await buildHeaders(init),
    });

    if (!response.ok) {
      const body = (await response.text()) || response.statusText;
      throw new Error(body);
    }

    return (await response.json()) as T;
  } catch (error) {
    throw new Error(toReadableError(error));
  }
}

export async function fetchSystemStatus<T>(signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}/system/status`, signal ? { signal } : undefined);
    if (!response.ok) {
      throw new Error(`System status request failed with ${response.status}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    throw new Error(toReadableError(error));
  }
}

export const getReadableApiError = (error: unknown) => toReadableError(error);
