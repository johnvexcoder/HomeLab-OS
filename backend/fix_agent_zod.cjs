const fs = require('fs');

const path = 'src/routes/agent.ts';
let code = fs.readFileSync(path, 'utf8');

const zodImport = "import { z } from 'zod';\n";
if (!code.includes("import { z }")) {
  code = code.replace("import { Router", zodImport + "import { Router");
}

const schemas = `
const AgentReportSchema = z.object({
  hostInfo: z.object({
    hostId: z.string(),
    hostName: z.string(),
    ip: z.string(),
    os: z.string().optional(),
    osId: z.string().optional(),
    kernel: z.string().optional(),
    arch: z.string().optional(),
    hostType: z.string().optional(),
    hypervisor: z.string().optional(),
    platform: z.string().optional(),
    manufacturer: z.string().optional(),
    product: z.string().optional(),
    machineId: z.string().optional(),
    uptimeSeconds: z.number().nonnegative().optional(),
  }).optional(),
  capabilities: z.array(z.string()).optional(),
  plugins: z.array(z.object({
    plugin: z.string(),
    collectedAt: z.number().positive(),
    data: z.record(z.unknown()),
  })).optional(),
  events: z.array(z.any()).optional(),
}).passthrough();
`;

if (!code.includes("AgentReportSchema")) {
  code = code.replace("export function createAgentRouter(): Router {", schemas + "\nexport function createAgentRouter(): Router {");
}

// Add validation to the report endpoint
const reportEndpointRegex = /router\.post\('\/report', requireAgentAuth, \(req: Request, res: Response\) => \{\n\s*try \{\n\s*const agent = \(req as any\)\.agent as Record<string, unknown>;\n\s*const body = req\.body as Record<string, unknown>;/;

const reportEndpointReplacement = `router.post('/report', requireAgentAuth, (req: Request, res: Response) => {
    try {
      const agent = (req as any).agent as Record<string, unknown>;
      
      const parsed = AgentReportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', details: parsed.error.issues });
        return;
      }
      const body = parsed.data;`;

code = code.replace(reportEndpointRegex, reportEndpointReplacement);

fs.writeFileSync(path, code);
