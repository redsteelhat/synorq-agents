import { z } from "zod";

/**
 * Every setting the service reads, validated once at startup. Integrations an
 * agent needs are optional here: a missing one makes that tool report "not
 * configured" instead of stopping the whole service.
 */
const optional = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional();

const schema = z.object({
  NODE_ENV: z.string().default("production"),
  PORT: z.coerce.number().int().positive().default(3000),
  TZ_NAME: z.string().default("Europe/Istanbul"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Dashboard sign-in (login form, signed session cookie).
  ADMIN_USER: z.string().min(1).default("admin"),
  ADMIN_PASSWORD: z.string().min(16, "ADMIN_PASSWORD must be at least 16 characters"),

  // Claude: a token from `claude setup-token` (Max plan) for internal agents.
  CLAUDE_CODE_OAUTH_TOKEN: optional,
  AGENT_MODEL: z.string().default("sonnet"),

  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_CHAT_ID: optional,

  SENTRY_DSN: optional,

  COOLIFY_URL: optional,
  COOLIFY_API_TOKEN: optional,

  SENTRY_API_URL: z.string().default("https://de.sentry.io"),
  SENTRY_API_TOKEN: optional,
  SENTRY_ORG: z.string().default("synorq"),

  UPTIMEROBOT_API_KEY: optional,

  UMAMI_URL: optional,
  UMAMI_USERNAME: optional,
  UMAMI_PASSWORD: optional,

  // Runs and their events older than this are deleted every night.
  RUN_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return parsed.data;
}
