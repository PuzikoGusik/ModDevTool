# ModDevTool
A web project that allows you to create your own Minecraft mod!

## Accounts

Registration and login use Netlify Identity with email, password, and a public nickname. Email confirmation is required by default. Nicknames are checked as you type, normalized consistently, and reserved in Netlify Database with a unique constraint during signup. Availability is advisory: the server also prevents two simultaneous registrations from claiming the same nickname. Legacy browser-only guest profiles are not credentials and are not automatically imported as accounts.

Password recovery sends a Netlify Identity email. Users can open its link or paste the complete link / one-time `recovery_token` into the recovery form, then choose a new password. This uses Identity's expiring recovery token, not a separate six-digit PIN or a locally stored password.

Google registration and login share the Google button. Enable Google under the project's Netlify Identity external-provider settings and configure the Google OAuth application there, including the callback URL shown by Netlify. Keep provider credentials in Netlify's settings, never in this repository. The button stays disabled with a setup message until Google is enabled. After Google login, users choose a database-backed unique nickname.

## Code workspace

Open **Код / javac** from the navigation. After generating a mod, plugin, or datapack, **Код проекта** opens its source archive in the workspace. Existing source ZIPs can also be imported. Java, HTML, CSS, JavaScript, JSON, mcfunction, YAML, TOML, Gradle, and properties files are editable; binary resources are retained unchanged. Edits are temporary: download the source ZIP before closing the tab.

HTML/CSS/JavaScript run in a sandboxed web preview. Datapacks are validated for JSON and pack metadata, then packaged as ZIPs; Minecraft checks command semantics on `/reload`. Datapacks do not use javac.

Java compilation runs on the user's device through CheerpJ 4.3 and a bundled OpenJDK javac compiler. Targets Java 8, 11, and 17 are supported. Successful builds contain actual `.class` files and project resources; syntax errors produce diagnostics instead of a fabricated JAR. Annotation processing is disabled and uploaded dependency JARs are used only as the compilation classpath, not executed or automatically bundled.

Add the matching Bukkit/Spigot/Paper API JAR when compiling plugins, or the appropriate Minecraft and loader API dependencies when checking mod code. Browser compilation is not a replacement for a loader's complete Gradle pipeline: Minecraft mods may require remapping/reobfuscation, so mod outputs are explicitly marked **dev JARs**, not install-ready mods. Projects requiring Java 21 or later are rejected with local Gradle instructions. Do not downgrade a project's Java target to bypass its actual requirements.

The first Java compilation downloads the browser runtime and compiler assets and can take several minutes. A compilation can be stopped and times out after four minutes. Limits are 150 Java sources / 4 MB of Java text, 32 MB of imported ZIP data, 48 MB unpacked project data, and 32 MB of dependency JARs. Java scratch files are removed after completed compilation; no source code is sent to a compilation server.

CheerpJ is a third-party runtime with its own licensing terms. Review its terms before commercial deployment. OpenJDK compiler provenance, corresponding sources, licenses, and symbol adaptation details are distributed in `assets/openjdk/`.

## Deployment and development

Use Node.js 22.12 or later and install dependencies with `npm ci`. Netlify's configured build command packages the static site and bundles the `@netlify/identity` browser client; only `public/` is published. Database schema is in `db/schema.ts`, and generated migrations are in `netlify/database/migrations/`. Netlify provisions the database and applies migrations during deployment. The Identity activation marker is included in `.netlify/features/`.

For local development, use `netlify dev --port 8889` after preparing the static site. `npm run typecheck` checks the backend types. After changing the database schema, generate a descriptive migration with `npm run db:generate -- --name <migration_name>`; do not commit connection strings or provider credentials.
