import type { ReactNode } from 'react';
import {
  Globe, Shield, Network, Server, Box, HardDrive,
  BatteryCharging, Laptop, Monitor, Cloud,
} from 'lucide-react';

function IconSvg({ children, size, color }: { children: ReactNode; size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  );
}

function ProxmoxIcon({ size }: { size: number }) {
  return (
    <IconSvg size={size} color="#E57000">
      <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.2L20.5 8 12 12.2 3.5 8 12 4.2zM4 9.5l7 3.5v7.5l-7-3.5V9.5zm9 11v-7.5l7-3.5v7.5l-7 3.5z" />
    </IconSvg>
  );
}

function DockerIcon({ size }: { size: number }) {
  return (
    <IconSvg size={size} color="#2496ED">
      <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.186.186 0 00-.186.186v1.888c0 .102.084.185.186.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.186h-2.118a.186.186 0 00-.186.186v1.888c0 .102.084.186.186.186m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.186h-2.118a.186.186 0 00-.186.186v1.888c0 .102.084.186.186.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.186H8.1a.186.186 0 00-.186.186v1.888c0 .102.084.186.186.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.186.186 0 00-.185-.186H5.136a.186.186 0 00-.186.186v1.888c0 .102.084.186.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.186v1.887c0 .102.084.186.185.186m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.186.186 0 00-.185-.186h-2.119a.186.186 0 00-.186.186v1.887c0 .102.084.186.186.186m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.186.186 0 00-.186-.186h-2.118a.186.186 0 00-.186.186v1.887c0 .102.084.186.186.186m-2.92 0h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186H2.172a.186.186 0 00-.186.186v1.887c0 .102.084.186.186.186M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z" />
    </IconSvg>
  );
}

function KubernetesIcon({ size }: { size: number }) {
  return (
    <IconSvg size={size} color="#326CE5">
      <path d="M12 1.5l-8.5 5v10l8.5 5 8.5-5v-10L12 1.5zm0 2.3L18 7.5v4.5L12 14.2 6 12V7.5L12 3.8zM4 8.2l7-4v4l-7 4v-4zm16 0v4l-7 4v-4l7-4z" fill="white" />
    </IconSvg>
  );
}

function PfSenseIcon({ size }: { size: number }) {
  return (
    <IconSvg size={size} color="#4B7BEC">
      <rect x="3" y="6" width="18" height="12" rx="2" fill="#4B7BEC" />
      <path d="M7 10h2v4H7zm4-1h2v6h-2zm4 2h2v3h-2z" fill="white" />
    </IconSvg>
  );
}

function TrueNAsIcon({ size }: { size: number }) {
  return (
    <IconSvg size={size} color="#0095D5">
      <path d="M4 7c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V7zm2 0v4h12V7H6zm0 6v4h12v-4H6z" fill="#0095D5" />
      <circle cx="8" cy="11" r="1.5" fill="white" />
      <circle cx="12" cy="11" r="1.5" fill="white" />
      <circle cx="16" cy="11" r="1.5" fill="white" />
    </IconSvg>
  );
}

export type InfraIconProps = { size?: number; className?: string };

/** Official-style infrastructure icons — SVG-based for crisp rendering at any size. */
export const INFRA_ICON_COMPONENTS: Record<string, React.FC<InfraIconProps>> = {
  internet: ({ size = 20 }: InfraIconProps) => <Globe size={size} className="text-info" />,
  gateway: ({ size = 20 }: InfraIconProps) => <Shield size={size} className="text-teal-400" />,
  firewall: ({ size = 20 }: InfraIconProps) => <PfSenseIcon size={size} />,
  switch: ({ size = 20 }: InfraIconProps) => <Network size={size} className="text-warn" />,
  bridge: ({ size = 20 }: InfraIconProps) => <Network size={size} className="text-text-muted" />,
  physical: ({ size = 20 }: InfraIconProps) => <Server size={size} className="text-text-secondary" />,
  hypervisor: ({ size = 20 }: InfraIconProps) => <ProxmoxIcon size={size} />,
  vm: ({ size = 20 }: InfraIconProps) => <Box size={size} className="text-emerald-400" />,
  lxc: ({ size = 20 }: InfraIconProps) => <Box size={size} className="text-blue-300" />,
  container: ({ size = 20 }: InfraIconProps) => <DockerIcon size={size} />,
  docker: ({ size = 20 }: InfraIconProps) => <DockerIcon size={size} />,
  podman: ({ size = 20 }: InfraIconProps) => <DockerIcon size={size} />,
  kubernetes: ({ size = 20 }: InfraIconProps) => <KubernetesIcon size={size} />,
  storage: ({ size = 20 }: InfraIconProps) => <HardDrive size={size} className="text-warn" />,
  nas: ({ size = 20 }: InfraIconProps) => <TrueNAsIcon size={size} />,
  ups: ({ size = 20 }: InfraIconProps) => <BatteryCharging size={size} className="text-success" />,
  cloud: ({ size = 20 }: InfraIconProps) => <Cloud size={size} className="text-text-secondary" />,
  laptop: ({ size = 20 }: InfraIconProps) => <Laptop size={size} className="text-text-secondary" />,
  desktop: ({ size = 20 }: InfraIconProps) => <Monitor size={size} className="text-text-secondary" />,
};
