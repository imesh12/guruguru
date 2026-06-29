import { useEffect, useState } from 'react';

type RuntimeConfig = {
  demoMode: boolean;
  apiBaseUrl: string;
  embeddedPlaybackPoc: boolean;
};

const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:4000';

export function useRuntimeConfig() {
  const [config, setConfig] = useState<RuntimeConfig>({
    demoMode: false,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    embeddedPlaybackPoc: false,
  });

  useEffect(() => {
    let disposed = false;

    if (!window.electronAPI?.getRuntimeConfig) {
      return () => {
        disposed = true;
      };
    }

    void window.electronAPI
      .getRuntimeConfig()
      .then((value) => {
        if (!disposed) {
          setConfig({
            demoMode: value.demoMode,
            apiBaseUrl: value.apiBaseUrl?.trim() || DEFAULT_API_BASE_URL,
            embeddedPlaybackPoc: value.embeddedPlaybackPoc,
          });
        }
      })
      .catch(() => {
        // Keep renderer usable if runtime config is temporarily unavailable.
      });

    return () => {
      disposed = true;
    };
  }, []);

  return config;
}
