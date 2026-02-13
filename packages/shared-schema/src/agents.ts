import { z } from "zod";

export const employmentTypeSchema = z.enum(["employee", "contractor"]);
export const agentRoleSchema = z.enum(["manager", "worker", "specialist", "unknown"]);

export const agentSchema = z.object({
  agent_id: z.string(),
  display_name: z.string(),
  role: agentRoleSchema,
  employment_type: employmentTypeSchema,
  is_persisted: z.boolean(),
  source: z.enum(["project_agent", "runtime_agent", "unknown"]),
  avatar_id: z.string().nullable(),
  status: z.string(),
  last_active_ts: z.string()
});

export type Agent = z.infer<typeof agentSchema>;
