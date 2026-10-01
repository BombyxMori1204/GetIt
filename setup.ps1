# setup.ps1 - creates the GetIt monorepo skeleton in the current folder
$ErrorActionPreference = "Stop"

# Write file as UTF-8 without BOM; \uXXXX escapes are expanded here
function Write-File($path, $content) {
    $dir = Split-Path $path -Parent
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $full = Join-Path (Get-Location).Path $path
    $content = [regex]::Unescape($content)
    [System.IO.File]::WriteAllText($full, $content, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "created $path"
}

if (-not (Test-Path ".git")) { git init }

# ---------- \u043a\u043e\u0440\u0435\u043d\u044c ----------
Write-File "package.json" @'
{
  "name": "getit",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "server": "npm run dev -w apps/server",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
'@

Write-File "tsconfig.base.json" @'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
'@

Write-File ".gitignore" @'
node_modules/
.env
apps/server/data/
.expo/
dist/
*.apk
'@

# ---------- packages/shared ----------
Write-File "packages/shared/package.json" @'
{
  "name": "@getit/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  }
}
'@

Write-File "packages/shared/tsconfig.json" @'
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
'@

Write-File "packages/shared/src/index.ts" @'
export * from "./types";
'@

Write-File "packages/shared/src/types.ts" @'
// \u0420\u0435\u0448\u0435\u043d\u0438\u0435 \u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0430\u0442\u0435\u043b\u044c\u043d\u043e\u0439 \u0441\u0438\u0441\u0442\u0435\u043c\u044b (\u0440\u0430\u0437\u0434\u0435\u043b 10.4 \u0422\u0417)
export type Decision = "BUY" | "WAIT" | "UNCERTAIN" | "INSUFFICIENT_DATA";

// \u041e\u0434\u043d\u0430 \u0442\u043e\u0447\u043a\u0430 \u0438\u0441\u0442\u043e\u0440\u0438\u0438 \u0446\u0435\u043d
export interface PricePoint {
  ts: number; // unix ms
  price: number;
}
'@

# ---------- packages/forecast ----------
Write-File "packages/forecast/package.json" @'
{
  "name": "@getit/forecast",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json"
  }
}
'@

Write-File "packages/forecast/tsconfig.json" @'
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
'@

Write-File "packages/forecast/src/index.ts" @'
// \u0417\u0430\u043f\u043e\u043b\u043d\u0438\u043c \u043d\u0430 \u044d\u0442\u0430\u043f\u0435 3: \u043f\u0440\u0435\u0434\u043e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0430, \u043c\u043e\u0434\u0435\u043b\u0438, \u043c\u0435\u0442\u0440\u0438\u043a\u0438, \u0431\u044d\u043a\u0442\u0435\u0441\u0442, recommend
export {};
'@

# ---------- apps/server ----------
Write-File "apps/server/package.json" @'
{
  "name": "@getit/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@getit/forecast": "*",
    "@getit/shared": "*"
  }
}
'@

Write-File "apps/server/tsconfig.json" @'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
'@

$envText = @'
PORT=3000
DB_PATH=./data/app.db
POLL_INTERVAL_HOURS=6
HORIZON_DAYS=7
MIN_DAYS=14
DROP_THRESHOLD=0.03
MAPE_MAX=0.10
EXPO_ACCESS_TOKEN=
'@
Write-File "apps/server/.env.example" $envText
Write-File "apps/server/.env" $envText

Write-File "apps/server/src/index.ts" @'
import Fastify from "fastify";

const app = Fastify({ logger: true });

// \u0412\u0440\u0435\u043c\u0435\u043d\u043d\u0430\u044f \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430, \u0447\u0442\u043e \u043e\u043a\u0440\u0443\u0436\u0435\u043d\u0438\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u043e
app.get("/health", async () => ({ ok: true }));

await app.listen({ port: 3000, host: "0.0.0.0" });
'@

# Empty folders so git keeps them
foreach ($d in @("routes", "db", "scraper/sites", "services", "scripts")) {
    Write-File "apps/server/src/$d/.gitkeep" ""
}

Write-Host ""
Write-Host "Skeleton ready. Next: install dependencies."