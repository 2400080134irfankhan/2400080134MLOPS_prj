export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  clientOrigin: process.env.CLIENT_ORIGIN ?? "",
};

export const demoAuthEnabled = process.env.NODE_ENV === "development"
  && process.env.DEMO_AUTH_ENABLED === "true"
  && Boolean(process.env.DEMO_AUTH_EMAIL?.trim() && process.env.DEMO_AUTH_PASSWORD);

export function validateEnvironment() {
  if (!ENV.isProduction) return;
  if (process.env.DEMO_AUTH_ENABLED?.trim().toLowerCase() === "true") {
    throw new Error("DEMO_AUTH_ENABLED must be false in production");
  }
  if (Buffer.byteLength(ENV.cookieSecret.trim()) < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes in production");
  }
  if (!ENV.appId.trim()) throw new Error("VITE_APP_ID is required in production");
  for (const [name, value, protocol] of [
    ["OAUTH_SERVER_URL", ENV.oAuthServerUrl, "https:"],
    ["DATABASE_URL", ENV.databaseUrl, "mysql:"],
  ]) {
    if (!URL.canParse(value) || new URL(value).protocol !== protocol) {
      throw new Error(`Set ${name} to a valid ${protocol} URL in production`);
    }
  }
}
