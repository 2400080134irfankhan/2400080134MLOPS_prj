import { build } from "esbuild";

await build({
  entryPoints: ["server/_core/index.ts"],
  outfile: "dist/index.js",
  platform: "node",
  bundle: true,
  packages: "external",
  format: "esm",
  define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: 'process.env.NODE_ENV = "production";' },
});
