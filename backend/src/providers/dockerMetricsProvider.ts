import type { ProviderDiagnostics } from './types';
import { DockerClient, type DockerContainer } from './dockerClient';
import { getBoolSetting, setSetting } from '../security/settings';
import { config } from '../config';

/**
 * Polls the Docker Engine API (over the mounted unix socket by default) and
 * keeps the latest container list + reachability diagnostics. The composite
 * provider decides where the containers appear on the map.
 *
 * Control flow: the provider only runs when DOCKER_ENABLED=true. On its first
 * successful connect it auto-enables the `docker_monitoring` feature flag, so
 * the user gets the Docker layer with zero manual toggling — while still being
 * able to switch it off from Configuration → Features.
 */
export class DockerMetricsProvider {
  private readonly client: DockerClient;
  private readonly host: string;
  private readonly pollIntervalMs: number;
  private interval: NodeJS.Timeout | null = null;
  private polling = false;
  private autoEnabled = false;
  private containers: DockerContainer[] = [];
  private lastPollAt: number | null = null;
  private lastPollError: string | null = null;
  private lastErrorAt: number | null = null;

  constructor() {
    this.host = config.docker.host;
    this.pollIntervalMs = config.docker.pollIntervalMs;
    this.client = new DockerClient(this.host);
  }

  /** The feature flag lives in the DB — docker nodes appear only while it's on. */
  private featureEnabled(): boolean {
    return getBoolSetting('feature.docker_monitoring');
  }

  async start(): Promise<void> {
    await this.poll();
    this.interval = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    if (!this.featureEnabled()) {
      this.containers = [];
      this.lastPollError = null;
      return;
    }
    this.polling = true;
    const started = Date.now();
    try {
      await this.client.ping();
      this.containers = await this.client.listContainers();
      this.lastPollError = null;
      this.lastPollAt = started;
      this.lastErrorAt = null;
      if (!this.autoEnabled) {
        this.autoEnabled = true;
        setSetting('feature.docker_monitoring', 'true');
        console.log('[docker] first successful connect — enabled Docker Monitoring feature flag');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastPollError = message;
      this.lastErrorAt = started;
      this.containers = [];
      console.warn(`[docker] poll failed: ${message}`);
    } finally {
      this.polling = false;
    }
  }

  getContainers(): DockerContainer[] {
    return this.containers;
  }

  getSourceName(): string {
    return this.featureEnabled() ? `docker (${this.host})` : 'docker (disabled)';
  }

  getDiagnostics(): ProviderDiagnostics {
    return {
      lastPollAt: this.lastPollAt,
      lastPollError: this.lastPollError,
      endpointErrors: this.lastPollError
        ? { [`${this.host} — docker daemon`]: this.lastPollError }
        : {},
    };
  }
}
