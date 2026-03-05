import fs from 'node:fs';
import path from 'node:path';
import { ACTION_ROUTE_OVERRIDES, APP_ROUTE_BY_APP_NAME } from '../lib/activity-routes';

const repoRoot = process.cwd();
const appDir = path.join(repoRoot, 'app');

const appRouteSegments = new Set(
  fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !['api', 'components'].includes(name))
);

function routeExists(route: string): boolean {
  if (route === '/') return true;
  if (!route.startsWith('/')) return false;
  const segment = route.slice(1).split('/')[0];
  return appRouteSegments.has(segment);
}

const missing: string[] = [];

for (const [appName, route] of Object.entries(APP_ROUTE_BY_APP_NAME)) {
  if (!routeExists(route)) {
    missing.push(`app "${appName}" -> "${route}"`);
  }
}

for (const [action, route] of Object.entries(ACTION_ROUTE_OVERRIDES)) {
  if (route && !routeExists(route)) {
    missing.push(`action "${action}" -> "${route}"`);
  }
}

if (missing.length > 0) {
  console.error('Activity route validation failed:');
  for (const item of missing) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log(
  `Activity route validation passed (${Object.keys(APP_ROUTE_BY_APP_NAME).length} app routes, ${Object.keys(
    ACTION_ROUTE_OVERRIDES
  ).length} action routes).`
);
