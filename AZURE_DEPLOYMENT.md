# Fraud Sentinel dashboard on Azure

## Release target

Use one 64-bit Linux App Service with the Node.js 24 LTS runtime. Start it with `node dist/index.js` from the package root. Express serves the React SPA and assets under `dist/public`, the OAuth callback, and tRPC under `/api/trpc`. It listens on the port Azure supplies. The server reads `datasets/` and `data/reputation/` during initialization. Enable HTTPS Only and set the App Service health check path to `/api/health`. This checks process liveness. The separate tRPC health query probes MySQL.

The repository Dockerfile starts Python/Uvicorn and expects a generated `models/` directory. Compose adds Kafka, MLflow, Prometheus and Grafana. Those services, the alternative Vercel functions, and Render configuration are outside the dashboard ZIP. The existing Python CI workflow remains independent. Its main-branch retraining job expects a raw CSV tracked via DVC but does not fetch it on a fresh checkout.

## Configure the application

| Location | Setting | Value or purpose |
| --- | --- | --- |
| GitHub repository variable and Azure app setting | `VITE_APP_ID` | Same public client ID registered with the application's Manus-compatible OAuth provider in both places |
| GitHub repository variable | `VITE_OAUTH_PORTAL_URL` | Public HTTPS login portal base URL, baked into the frontend at build time |
| GitHub repository variable | `AZURE_DEPLOY_ENABLED` | Leave unset during preparation. Set to `true` when main-branch releases are authorized |
| GitHub production environment variable | `AZURE_WEBAPP_NAME` | Exact App Service resource name |
| Azure app setting | `NODE_ENV` | `production` |
| Azure app setting | `DEMO_AUTH_ENABLED` | `false`. Omit both demo credential settings |
| Azure app setting | `OAUTH_SERVER_URL` | HTTPS base for the provider's WebDevAuth API, including token exchange and user info |
| Azure secret setting | `JWT_SECRET` | At least 32 random bytes, generated privately, stable across instances, unique to production |
| Azure secret setting | `DATABASE_URL` | mysql2-compatible MySQL connection URI with certificate-verified TLS, URL-encoded credentials and the target database |
| Azure app setting | `OWNER_OPEN_ID` | Optional exact, provider-verified subject of the designated administrator |
| Azure app setting | `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false`, since CI packages Linux production dependencies |

Keep `CLIENT_ORIGIN` and `VITE_API_BASE_URL` empty for same-origin hosting. Let Azure supply `PORT`. Use App Service secret settings or Key Vault references for server secrets. Only public configuration belongs in `VITE_*`. A change to the login portal or public client ID requires a new frontend build.

Register the exact callback `https://<public-host>/api/oauth/callback` with the identity provider. The client uses the browser's origin. The provider must implement the existing application OAuth protocol. GitHub's Azure federation authenticates the deployment job separately.

Provision connectivity and TLS for MySQL. Have the database owner apply the reviewed MySQL migration identified by `drizzle/meta/_journal.json` (`drizzle/0000_soft_captain_midlands.sql`) to a new database or reconcile the existing schema. The PostgreSQL baseline is for a different stack. The runtime account needs select, insert and update access on the users table. Verify that normal sign-ins get the default user role and only intended subjects have the admin role. Clearing `OWNER_OPEN_ID` stops automatic grants; revoke any previously stored admin role in MySQL as well.

## GitHub Actions and Azure federation

1. Enable GitHub Actions and allow the pinned GitHub, pnpm and Azure actions. Pushes to `azure-deployment-prep` run validation only. Pull requests targeting `main` and pushes to `main` also run validation. Configure branch protection on `main` to require the dashboard validation job and reviewed changes to its workflow and packaging script.
2. Create the GitHub environment named exactly `production`. Restrict its deployment branches to `main`, configure required reviewers, prevent self-review, and restrict administrator bypass where supported. Check that the repository plan and visibility support these protections. Naming an environment in YAML alone does not enforce approval. Keep the repository variable `AZURE_DEPLOY_ENABLED` unset until the protections and target settings are in place.
3. In the intended Azure subscription, configure the target app for Linux **Code**, Node 24 LTS, and the startup command and HTTPS settings above. Enable App Service Health Check at `/api/health`. Allow the deployment runner to reach the app's SCM deployment endpoint and the HTTPS app hostname. A network-restricted app may require an approved runner with private connectivity. Check that platform-level authentication allows the public health and sign-in routes to reach Express.
4. Configure a Microsoft Entra application or user-assigned managed identity with Website Contributor scoped to that web app. For the ordinary GitHub environment subject, register issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange` and subject `repo:<owner>/<repository>:environment:production`. If your organization customizes OIDC subjects, match its actual claim. Use the identity's **client ID** for `AZURE_CLIENT_ID`. Set that value, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID` as GitHub production environment secrets. Set `AZURE_WEBAPP_NAME` as an environment variable. OIDC requires no client secret or publish profile.
5. Set both public OAuth build variables at **repository** scope so the validation job can use them. Set the matching runtime values and private application settings in Azure. Review and include the synchronized pnpm lockfile and wouter patch when preparing the future commit. CI takes pnpm 10.4.1 from `package.json` and uses frozen installs for build and production dependencies.
6. When a production rollout is authorized, set the repository variable `AZURE_DEPLOY_ENABLED=true`. The next eligible push to `main` must pass validation and the configured environment gate. Changing the variable alone does not start a run. The deploy job downloads the artifact from the same run, obtains its OIDC token, and targets the app's production slot. Pending artifacts expire after seven days.

## Package and verification

CI packages the Express bundle, SPA entry and compiled JS/CSS, package manifest, hoisted runtime dependencies and the reputation directory's `domains.json`. Each of the three model families needs its metadata and both synthetic train/test workbooks at startup. The packager selects those nine files explicitly. It omits the dataset manifest, other data, local environment files, and the Python application. The packager rejects environment/configuration filenames and recognizable private key material in selected inputs. Keep secrets out of frontend source and all Vite build inputs.

CI extracts the ZIP outside the checkout and smoke-tests the extracted application before artifact upload. Production settings used in that test are disposable. Following an authorized deployment, the runner retries the HTTPS health endpoint, checks for the Fraud Sentinel service identifier, and compares the served SPA entry to the ZIP by SHA-256. A failed probe marks the job failed; the uploaded release can still be active. Inspect App Service logs and choose recovery or rollback separately. A successful liveness check leaves database and real user sign-in verification to the acceptance checks below.

[Configure the App Service Node runtime](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs) ? [Configure Azure OIDC for GitHub Actions](https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions) ? [GitHub environment protection rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

## Release acceptance and remaining limits

After an authorized staging deployment, load the login page over HTTPS, complete real OAuth sign-ins with separate analyst and admin accounts, confirm their roles through `auth.me`, exercise an analyst action, and verify a privileged operation returns 403 for the analyst and succeeds for the admin. Confirm the callback cookie has Secure and HttpOnly flags, logout clears browser access, and an anonymous dashboard request returns 401. Verify the health check and database connectivity independently. Local tests use a disposable signing key and doubles for the external provider and user store.

Treat this release as a single-instance dashboard simulation. MySQL persists identities and roles. Scan history, alerts, audit events, model registry, pipeline position and settings live in process memory. Restarts discard them and multiple workers can disagree. Durable audit storage, retention limits, rate limits for scan/training endpoints, and controlled outbound network access for URL analysis are outstanding before handling sensitive operational traffic. Session cookies currently last up to one year and clearing a browser cookie does not revoke a copied JWT. Review session lifetime and revocation requirements before a live rollout. Scope optional storage-provider credentials to the intended shared workspace. Separate Python endpoints have their own access model and need an independent review before public exposure.
