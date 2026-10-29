# Assist Management System

A small Node.js application with a static HTML/CSS/JavaScript dashboard and two authentication API routes. Assistance requests are stored in the browser's `localStorage`; they are not a secure, shared database.

## Run locally

1. Install Node.js 22.9 or newer.
2. In the project root, create a file named `.env` with these three server-only settings:

   ```text
   LOGIN_USERNAME=your-admin-username
   LOGIN_PASSWORD=your-admin-password
   JWT_SECRET=your-random-secret-at-least-32-bytes-long
   ```

   Use your own values. Do not commit `.env` or paste its values into public places. It is ignored by Git.
3. Start the server:

   ```text
   npm start
   ```

   On Windows PowerShell, if `npm` is blocked by the script execution policy, run `npm.cmd start` instead (or use Command Prompt).
4. Open <http://localhost:3000>.

The login and session APIs are also served locally by `server.js`. If the required environment variables are missing or `JWT_SECRET` is shorter than 32 bytes, the local server prints a configuration error and exits.

## Deploy to Vercel

The project uses Vercel's standard static assets and Node.js function conventions: frontend files are in `public/`; `/api/login` and `/api/session` are in `api/`. No custom build step or `vercel.json` is needed.

In the existing Vercel project, check **Settings → Build and Deployment**:

- **Root Directory:** the repository root (`./`)
- **Framework Preset:** `Other`
- **Build Command:** leave at its default; this project has no build step
- **Output Directory:** leave at its default; keep `public/` as the static source folder
- **Install Command:** leave at its default; the project has no third-party dependencies

Under **Settings → Environment Variables**, add the following names with your own private values. Do not put these in frontend code:

| Name | Purpose |
| --- | --- |
| `LOGIN_USERNAME` | Administrator username |
| `LOGIN_PASSWORD` | Administrator password |
| `JWT_SECRET` | Random signing key of at least 32 bytes |

Add them for each deployment environment you use (Production, Preview, and Development as appropriate), then redeploy so the new values are available to the functions. The API returns a configuration error if a required value is missing or the signing key is too short; secret values are never sent to the browser.

### Push your changes from VS Code

After reviewing the files in Source Control, stage and commit the intended changes. From the VS Code terminal, you can also run:

```text
git status
git add .gitignore README.md server.js server.test.js api lib public
git commit -m "Fix Vercel deployment architecture"
git branch --show-current
git push origin <your-branch>
```

Replace `<your-branch>` with the branch name printed by the previous command. Do not include `.env` in the staged files. If your Vercel project is connected to this GitHub repository, pushing to its configured production branch or opening a pull request triggers a deployment according to that project's Git settings. These commands do not run automatically.

### If deployment still fails

In Vercel, open the project and select the failed deployment:

1. Check **Build Logs** for build and file-discovery errors.
2. Open **Functions** or **Runtime Logs** for `/api/login` and `/api/session` errors.
3. Confirm the deployment uses the repository root and that all three environment variables are set for that deployment's environment.
4. Redeploy after changing environment variables or project settings.

Vercel's current references: [Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js), [Functions API Reference](https://vercel.com/docs/functions/functions-api-reference), and [Build Configuration](https://vercel.com/docs/builds/configure-a-build).
