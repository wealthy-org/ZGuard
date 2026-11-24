export type RouteId =
  | 'home'
  | 'console'
  | 'checks'
  | 'architecture'
  | 'zk'
  | 'registry'
  | 'api'
  | 'docs'
  | 'faq';

export interface RouteDef {
  id: RouteId;
  path: string;
  label: string;
  hint: string;
}

export type Navigate = (id: RouteId) => void;

export const ROUTES: RouteDef[] = [
  { id: 'home', path: '/', label: 'Home', hint: 'Overview' },
  { id: 'console', path: '/console', label: 'Guard Console', hint: 'POST /v1/guard' },
  { id: 'checks', path: '/checks', label: 'Three Checks', hint: 'Quote · Simulation · Token risk' },
  { id: 'architecture', path: '/architecture', label: 'Architecture', hint: 'Signer & distribution' },
  { id: 'zk', path: '/zk', label: 'ZK Layer', hint: 'Groth16 · Halo2-KZG' },
  { id: 'registry', path: '/registry', label: 'RHC Registry', hint: 'Chain 4663 assets' },
  { id: 'api', path: '/api', label: 'API & Pricing', hint: 'x402 · USDG' },
  { id: 'docs', path: '/docs', label: 'Docs', hint: 'Full reference' },
  { id: 'faq', path: '/faq', label: 'FAQ', hint: 'Questions' },
];

export const NAV_ROUTES = ROUTES.filter((r) => r.id !== 'home' && r.id !== 'faq' && r.id !== 'docs');

export const X_URL = 'https://x.com/zguard_rhc';

export function routeFromHash(hash: string): RouteId {
  const path = hash.replace(/^#/, '') || '/';
  const found = ROUTES.find((r) => r.path === path);
  return found ? found.id : 'home';
}
