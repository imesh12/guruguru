import { useEffect, useState } from 'react';

type RuntimeConfig = {
  demoMode: boolean;
  apiBaseUrl: string;
  embeddedPlaybackPoc: boolean;
};

export function useRuntimeConfig() {
  const [config, setConfig] = useState<RuntimeConfig>({
    demoMode: false,
    apiBaseUrl: 'http://127.0.0.1:4000',
    embeddedPlaybackPoc: false,
  });

  useEffect(() => {
    let disposed = false;

    void window.electronAPI
      .getRuntimeConfig()
      .then((value) => {
        if (!disposed) {
          setConfig(value);
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
