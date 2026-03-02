'use client';

import { useEffect, useState } from 'react';

interface LocationMapProps {
  latitude: number;
  longitude: number;
  address?: string | null;
  className?: string;
  height?: string;
}

/**
 * Small Leaflet map showing a single location. Loaded only on client (use with dynamic import ssr: false).
 * Uses OpenStreetMap tiles — no API key required.
 */
export default function LocationMap({ latitude, longitude, address, className = '', height = '180px' }: LocationMapProps) {
  const [MapComponent, setMapComponent] = useState<React.ComponentType<{
    lat: number;
    lng: number;
    address?: string | null;
    height: string;
  }> | null>(null);

  useEffect(() => {
    import('./LocationMapInner').then((mod) => setMapComponent(() => mod.default));
  }, []);

  if (!MapComponent) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 text-sm ${className}`}
        style={{ height }}
      >
        Loading map…
      </div>
    );
  }

  return <MapComponent lat={latitude} lng={longitude} address={address} height={height} />;
}
