import { createContext, useContext, type ReactNode } from 'react';
import type { Ports } from './ports';

const PortsContext = createContext<Ports | null>(null);

export function PortsProvider({ ports, children }: { ports: Ports; children: ReactNode }) {
  return <PortsContext.Provider value={ports}>{children}</PortsContext.Provider>;
}

export function usePorts(): Ports {
  const ports = useContext(PortsContext);
  if (!ports) throw new Error('usePorts outside PortsProvider');
  return ports;
}
