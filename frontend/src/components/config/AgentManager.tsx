import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Server,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  Key,
  Clock,
  BookOpen,
  ExternalLink,
  X,
} from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusDot } from '@/components/ui/Status';
import { cn } from '@/lib/utils';

interface Agent {
  id: string;
  host_id: string;
  host_name: string;
  ip: string;
  api_key_prefix: string;
  os: string;
  cpu_cores: number;
  ram_total_gb: number;
  host_type: string;
  cpu_usage: number;
  ram_used_gb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  net_down_mbps: number;
  net_up_mbps: number;
  uptime_seconds: number;
  temp_c: number | null;
  load_1: number;
  containers_json: string;
  status: string;
  last_report_at: number | null;
  created_at: number;
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatBytes(gb: number): string {
  if (gb < 1) return `${Math.round(gb * 1024)} MB`;
  return `${gb.toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const OS_TABS = [
  { id: 'proxmox', label: 'Proxmox' },
  { id: 'debian', label: 'Debian' },
  { id: 'ubuntu', label: 'Ubuntu' },
  { id: 'fedora', label: 'Fedora' },
  { id: 'others', label: 'Docker' },
] as const;

export function AgentManager() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [installGuideTarget, setInstallGuideTarget] = useState<{ hostName: string; hostId: string; ip: string; apiKeyPrefix: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [newHostId, setNewHostId] = useState('');
  const [newHostName, setNewHostName] = useState('');
  const [creating, setCreating] = useState(false);
  const [installTab, setInstallTab] = useState('proxmox');
  const [justCreated, setJustCreated] = useState<{ agent: Agent; apiKey: string } | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<{ agents: Agent[] }>('/admin/agents');
      setAgents(res.agents);
    } catch {
      // access denied or not configured
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAgents(); }, [fetchAgents]);

  const openInstallGuide = (target: { hostName: string; hostId: string; ip: string; apiKeyPrefix: string } | null) => {
    setInstallGuideTarget(target);
    setShowInstallGuide(true);
  };

  const createAgent = async () => {
    if (!newHostId.trim() || !newHostName.trim()) return;
    setCreating(true);
    try {
      const res = await api.post<{ agentId: string; hostId: string; hostName: string; apiKey: string }>(
        '/admin/agents',
        { hostId: newHostId.trim(), hostName: newHostName.trim() },
      );
      setJustCreated({
        agent: {
          id: res.agentId,
          host_id: res.hostId,
          host_name: res.hostName,
          api_key_prefix: res.apiKey.slice(0, 12),
          ip: '',
          os: '',
          cpu_cores: 0,
          ram_total_gb: 0,
          host_type: 'unknown',
          cpu_usage: 0,
          ram_used_gb: 0,
          disk_used_gb: 0,
          disk_total_gb: 0,
          net_down_mbps: 0,
          net_up_mbps: 0,
          uptime_seconds: 0,
          temp_c: null,
          load_1: 0,
          containers_json: '[]',
          status: 'pending',
          last_report_at: null,
          created_at: Date.now(),
        },
        apiKey: res.apiKey,
      });
      setNewHostId('');
      setNewHostName('');
      setShowCreate(false);
      void fetchAgents();
    } catch {
      // handled by api
    } finally {
      setCreating(false);
    }
  };

  const deleteAgent = async (id: string) => {
    if (!confirm('Delete this agent? It will stop receiving data.')) return;
    await api.delete(`/admin/agents/${id}`);
    void fetchAgents();
  };

  const rotateKey = async (id: string) => {
    if (!confirm('Rotate API key? The old key will stop working immediately.')) return;
    const res = await api.post<{ apiKey: string }>(`/admin/agents/${id}/rotate-key`);
    setCopiedKey(res.apiKey);
    void copyToClipboard(res.apiKey);
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 3000);
  };

  const apiKeyHint = installGuideTarget?.apiKeyPrefix ? `${installGuideTarget.apiKeyPrefix}...` : 'YOUR_API_KEY';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-base font-bold text-text-primary">Agents</h3>
          <p className="mt-0.5 text-xs text-text-muted">Remote hosts reporting metrics via the HomeLab Agent</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openInstallGuide(null)}>
            <BookOpen className="h-3.5 w-3.5" /> Installation Guide
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void fetchAgents()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" /> New Agent
          </Button>
        </div>
      </div>

      {/* Just-created banner with API key */}
      <AnimatePresence>
        {justCreated && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-success/25 bg-success/5 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-success">Agent created successfully</div>
                <p className="mt-1 text-xs text-text-muted">
                  Copy this API key now — it will not be shown again.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="rounded-lg bg-surface px-3 py-1.5 text-xs font-mono text-text-primary select-all">
                    {justCreated.apiKey}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void copyToClipboard(justCreated.apiKey)}
                  >
                    {copiedKey === justCreated.apiKey ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
              <button onClick={() => setJustCreated(null)} className="text-text-muted hover:text-text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Agent list */}
      {loading ? (
        <div className="py-8 text-center text-sm text-text-muted">Loading agents…</div>
      ) : agents.length === 0 ? (
        <div className="card flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Server className="h-7 w-7" />
          </div>
          <div>
            <div className="text-sm font-bold text-text-primary">No agents registered yet</div>
            <p className="mt-1.5 max-w-sm text-xs text-text-muted">
              Agents run on remote VMs to report CPU, RAM, disk, network and container metrics back to this dashboard.
              Follow the Installation Guide to get started.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => openInstallGuide(null)}>
              <BookOpen className="h-3.5 w-3.5" /> Installation Guide
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5" /> Create Agent
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {agents.map((agent) => {
            const containers = (() => {
              try { return JSON.parse(agent.containers_json) as Array<{ name: string; running: boolean }>; }
              catch { return []; }
            })();
            const runningCt = containers.filter((c) => c.running).length;

            return (
              <motion.div
                key={agent.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-surface-border bg-surface-elevated text-lg">
                      {agent.host_type === 'hypervisor' ? '🖥️' : agent.host_type === 'vm' ? '📦' : '🔧'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-text-primary">{agent.host_name}</span>
                        <StatusDot status={agent.status === 'online' ? 'online' : agent.status === 'pending' ? 'degraded' : 'offline'} pulse={agent.status === 'online'} />
                        <Badge tone={agent.status === 'online' ? 'success' : agent.status === 'pending' ? 'warn' : 'neutral'}>
                          {agent.status}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                        <span className="font-mono">{agent.host_id}</span>
                        {agent.ip && <span>{agent.ip}</span>}
                        {agent.os && <span>{agent.os}</span>}
                        {agent.host_type !== 'unknown' && <Badge tone="neutral">{agent.host_type}</Badge>}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Last report {timeAgo(agent.last_report_at)}
                        </span>
                      </div>
                      {agent.status === 'online' && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary">
                          <span>CPU {agent.cpu_usage.toFixed(1)}%</span>
                          <span>RAM {formatBytes(agent.ram_used_gb)}/{formatBytes(agent.ram_total_gb)}</span>
                          <span>Disk {formatBytes(agent.disk_used_gb)}/{formatBytes(agent.disk_total_gb)}</span>
                          <span>Load {agent.load_1.toFixed(1)}</span>
                          {agent.temp_c != null && <span>{agent.temp_c}°C</span>}
                          {runningCt > 0 && <span>{runningCt} CTs</span>}
                          <span>Up {formatUptime(agent.uptime_seconds)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Installation Guide"
                      onClick={() => openInstallGuide({
                        hostName: agent.host_name,
                        hostId: agent.host_id,
                        ip: agent.ip,
                        apiKeyPrefix: agent.api_key_prefix,
                      })}
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void rotateKey(agent.id)}>
                      <Key className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void deleteAgent(agent.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-crit" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Create agent dialog */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-2xl border border-surface-border bg-surface p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-display text-base font-bold text-text-primary">Create New Agent</h3>
              <p className="mt-1 text-xs text-text-muted">
                Assign a unique host ID and display name. The API key will be shown once after creation.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">Host ID</label>
                  <input
                    type="text"
                    value={newHostId}
                    onChange={(e) => setNewHostId(e.target.value)}
                    placeholder="e.g. vm-jellyfin"
                    className="w-full rounded-lg border border-surface-border bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">Display Name</label>
                  <input
                    type="text"
                    value={newHostName}
                    onChange={(e) => setNewHostName(e.target.value)}
                    placeholder="e.g. Jellyfin Server"
                    className="w-full rounded-lg border border-surface-border bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void createAgent()} disabled={creating || !newHostId.trim() || !newHostName.trim()}>
                  {creating ? 'Creating…' : 'Create Agent'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Installation Guide dialog */}
      <AnimatePresence>
        {showInstallGuide && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setShowInstallGuide(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-surface-border bg-surface p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-display text-base font-bold text-text-primary">Installation Guide</h3>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {installGuideTarget
                      ? <>Deploy the HomeLab Agent on <b>{installGuideTarget.hostName}</b></>
                      : <>Install the HomeLab Agent on any remote server or VM</>
                    }
                  </p>
                </div>
                <button onClick={() => setShowInstallGuide(false)} className="text-text-muted hover:text-text-primary">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* OS tabs */}
              <div className="mt-4 flex flex-wrap gap-1 rounded-lg bg-overlay/5 p-0.5">
                {OS_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setInstallTab(tab.id)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
                      installTab === tab.id
                        ? 'bg-accent/15 text-accent'
                        : 'text-text-muted hover:text-text-primary',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Quick-start: Docker (Others tab) */}
              {installTab === 'others' && (
                <div className="mt-4 space-y-3">
                  <InstallStep num={1} title="Docker (recommended for any OS)">
                    <CodeBlock>{`docker run -d \\
  --name homelab-agent \\
  --restart unless-stopped \\
  -e DASHBOARD_URL=http://YOUR_DASHBOARD_IP:4000 \\
  -e API_KEY=${apiKeyHint} \\
  -v /proc:/host/proc:ro \\
  -v /sys:/host/sys:ro \\
  ghcr.io/johnvexcoder/homelab-agent:latest`}</CodeBlock>
                  </InstallStep>
                  <InstallStep num={2} title="Verify in dashboard">
                    <span className="text-xs text-text-muted">The agent should appear online within 10 seconds</span>
                  </InstallStep>
                </div>
              )}

              {/* Linux native: Proxmox, Debian, Ubuntu, Fedora */}
              {installTab === 'proxmox' && (
                <div className="mt-4 space-y-3">
                  <InstallStep num={1} title="SSH into your Proxmox host">
                    <CodeBlock>ssh root@{installGuideTarget?.ip || 'PROXMOX_IP'}</CodeBlock>
                  </InstallStep>
                  <InstallStep num={2} title="Clone and run the installer">
                    <CodeBlock>{`git clone https://github.com/johnvexcoder/HomeLab-Agent.git /opt/homelab-agent
cd /opt/homelab-agent
sudo ./install.sh \\
  --dashboard-url http://YOUR_DASHBOARD_IP:4000 \\
  --api-key ${apiKeyHint}`}</CodeBlock>
                  </InstallStep>
                  <InstallStep num={3} title="Verify the service is running">
                    <CodeBlock>sudo systemctl status homelab-agent</CodeBlock>
                  </InstallStep>
                  <InstallStep num={4} title="What gets installed">
                    <div className="text-[11px] text-text-muted space-y-1">
                      <p>The installer will automatically detect your Proxmox environment and install:</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li><b>lm-sensors</b> — temperature monitoring</li>
                        <li><b>vnstat</b> — persistent network traffic counters</li>
                        <li><b>Node.js runtime</b> (if not present)</li>
                      </ul>
                      <p className="mt-1">A systemd service <code>homelab-agent</code> is created and enabled on boot.</p>
                    </div>
                  </InstallStep>
                </div>
              )}

              {installTab === 'debian' && (
                <div className="mt-4 space-y-3">
                  <InstallStep num={1} title="SSH into your Debian server">
                    <CodeBlock>ssh root@{installGuideTarget?.ip || 'SERVER_IP'}</CodeBlock>
                  </InstallStep>
                  <InstallStep num={2} title="Clone and run the installer">
                    <CodeBlock>{`git clone https://github.com/johnvexcoder/HomeLab-Agent.git /opt/homelab-agent
cd /opt/homelab-agent
sudo ./install.sh \\
  --dashboard-url http://YOUR_DASHBOARD_IP:4000 \\
  --api-key ${apiKeyHint}`}</CodeBlock>
                  </InstallStep>
                  <InstallStep num={3} title="Verify the service is running">
                    <CodeBlock>sudo systemctl status homelab-agent</CodeBlock>
                  </InstallStep>
                  <InstallStep num={4} title="What gets installed">
                    <div className="text-[11px] text-text-muted space-y-1">
                      <p>The installer auto-installs prerequisites on Debian:</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li><code>apt install lm-sensors vnstat</code></li>
                        <li>Node.js 20 (via NodeSource)</li>
                      </ul>
                    </div>
                  </InstallStep>
                </div>
              )}

              {installTab === 'ubuntu' && (
                <div className="mt-4 space-y-3">
                  <InstallStep num={1} title="SSH into your Ubuntu server">
                    <CodeBlock>ssh root@{installGuideTarget?.ip || 'SERVER_IP'}</CodeBlock>
                  </InstallStep>
                  <InstallStep num={2} title="Clone and run the installer">
                    <CodeBlock>{`git clone https://github.com/johnvexcoder/HomeLab-Agent.git /opt/homelab-agent
cd /opt/homelab-agent
sudo ./install.sh \\
  --dashboard-url http://YOUR_DASHBOARD_IP:4000 \\
  --api-key ${apiKeyHint}`}</CodeBlock>
                  </InstallStep>
                  <InstallStep num={3} title="Verify the service is running">
                    <CodeBlock>sudo systemctl status homelab-agent</CodeBlock>
                  </InstallStep>
                  <InstallStep num={4} title="What gets installed">
                    <div className="text-[11px] text-text-muted space-y-1">
                      <p>The installer auto-installs prerequisites on Ubuntu:</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li><code>apt install lm-sensors vnstat</code></li>
                        <li>Node.js 20 (via NodeSource)</li>
                      </ul>
                    </div>
                  </InstallStep>
                </div>
              )}

              {installTab === 'fedora' && (
                <div className="mt-4 space-y-3">
                  <InstallStep num={1} title="SSH into your Fedora server">
                    <CodeBlock>ssh root@{installGuideTarget?.ip || 'SERVER_IP'}</CodeBlock>
                  </InstallStep>
                  <InstallStep num={2} title="Clone and run the installer">
                    <CodeBlock>{`git clone https://github.com/johnvexcoder/HomeLab-Agent.git /opt/homelab-agent
cd /opt/homelab-agent
sudo ./install.sh \\
  --dashboard-url http://YOUR_DASHBOARD_IP:4000 \\
  --api-key ${apiKeyHint}`}</CodeBlock>
                  </InstallStep>
                  <InstallStep num={3} title="Verify the service is running">
                    <CodeBlock>sudo systemctl status homelab-agent</CodeBlock>
                  </InstallStep>
                  <InstallStep num={4} title="What gets installed">
                    <div className="text-[11px] text-text-muted space-y-1">
                      <p>The installer auto-installs prerequisites on Fedora:</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li><code>dnf install lm_sensors vnstat</code></li>
                        <li>Node.js 20 (via NodeSource)</li>
                      </ul>
                    </div>
                  </InstallStep>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InstallStep({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">
        {num}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-text-primary">{title}</div>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(String(children));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <pre className="rounded-lg bg-surface-input p-3 pr-10 text-[11px] font-mono text-text-primary overflow-x-auto whitespace-pre-wrap">
        {children}
      </pre>
      <button
        onClick={() => void copy()}
        className="absolute top-2 right-2 rounded-md p-1 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity hover:text-text-primary cursor-pointer"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
