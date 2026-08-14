import net from 'node:net';
import tls from 'node:tls';
import { getBoolSetting, getIntSetting, getSetting } from './settings';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  secure: boolean;
}

/** True when the admin has configured outbound SMTP. */
export function smtpConfigured(): boolean {
  const cfg = getSmtpConfig();
  return Boolean(cfg.host && cfg.port > 0 && cfg.from);
}

/** Never returns secrets to callers — only booleans/status for the UI. */
export function smtpStatus(): { configured: boolean; host: string; from: string } {
  const cfg = getSmtpConfig();
  return { configured: smtpConfigured(), host: cfg.host, from: cfg.from };
}

export function getSmtpConfig(): SmtpConfig {
  const rawPort = getIntSetting('security.smtpPort', 587);
  return {
    host: getSetting('security.smtpHost').trim(),
    port: rawPort,
    user: getSetting('security.smtpUser').trim(),
    password: getSetting('security.smtpPassword'),
    from: getSetting('security.smtpFrom').trim(),
    secure: getBoolSetting('security.smtpSecure'),
  };
}

const CRLF = '\r\n';

interface SmtpSession {
  socket: net.Socket;
  buffer: { data: string };
}

function readLine(socket: net.Socket, buffer: { data: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      buffer.data += chunk.toString('utf8');
      const idx = buffer.data.indexOf('\n');
      if (idx === -1) return;
      const line = buffer.data.slice(0, idx).replace(/\r$/, '');
      buffer.data = buffer.data.slice(idx + 1);
      socket.off('data', onData);
      const code = Number.parseInt(line.slice(0, 3), 10);
      if (code >= 400) reject(new Error(`SMTP error: ${line}`));
      else resolve(line);
    };
    socket.on('data', onData);
  });
}

function command(session: SmtpSession, cmd: string): Promise<string> {
  session.socket.write(cmd + CRLF);
  return readLine(session.socket, session.buffer);
}

/**
 * Minimal dependency-free SMTP client supporting plaintext, implicit TLS
 * (465) and STARTTLS (587). Throws on any non-2xx response.
 */
export async function sendEmail(opts: {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const session: SmtpSession = { socket: null as unknown as net.Socket, buffer: { data: '' } };

  const connect = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const secure = opts.port === 465;
      const socket = secure
        ? tls.connect({ host: opts.host, port: opts.port, rejectUnauthorized: false })
        : net.connect({ host: opts.host, port: opts.port });
      session.socket = socket;
      socket.once('connect', resolve);
      socket.once('error', reject);
    });

  try {
    await connect();
    await readLine(session.socket, session.buffer); // banner
    const ehlo = await command(session, `EHLO homelab-dashboard`);
    const supportsStartTls = ehlo.toUpperCase().includes('STARTTLS');

    if (opts.user && opts.password) {
      if (opts.port === 587 && supportsStartTls) {
        await command(session, 'STARTTLS');
        const upgraded = tls.connect({ socket: session.socket, rejectUnauthorized: false });
        session.socket = upgraded;
        await new Promise<void>((resolve, reject) => {
          upgraded.once('secureConnect', resolve);
          upgraded.once('error', reject);
        });
        await readLine(session.socket, session.buffer); // post-STARTTLS banner
        await command(session, `EHLO homelab-dashboard`);
      }
      await command(session, `AUTH LOGIN`);
      await command(session, Buffer.from(opts.user).toString('base64'));
      await command(session, Buffer.from(opts.password).toString('base64'));
    }

    await command(session, `MAIL FROM:<${opts.from}>`);
    await command(session, `RCPT TO:<${opts.to}>`);
    await command(session, 'DATA');
    session.socket.write(
      `From: ${opts.from}${CRLF}To: ${opts.to}${CRLF}Subject: ${opts.subject}${CRLF}` +
        `MIME-Version: 1.0${CRLF}Content-Type: text/plain; charset=utf-8${CRLF}${CRLF}` +
        `${opts.text}${CRLF}.${CRLF}`,
    );
    await readLine(session.socket, session.buffer);
    await command(session, 'QUIT');
  } finally {
    session.socket?.destroy();
  }
}

/** Sends an OTP email to a user using the configured SMTP settings. */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const cfg = getSmtpConfig();
  if (!cfg.host || !cfg.from) throw new Error('smtp_not_configured');
  await sendEmail({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    from: cfg.from,
    to,
    subject: 'HomeLab OS — verification code',
    text: [
      'Your HomeLab OS verification code is:',
      '',
      `  ${code}`,
      '',
      'This code expires in 10 minutes. If you did not request it, you can safely ignore this email.',
    ].join('\n'),
  });
}
