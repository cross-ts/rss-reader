import type { IconName } from './Icon';
import type { RoutePath } from '../hooks/useHashRoute';

export const NAVS: { path: RoutePath; href: string; label: string; icon: IconName; style: 'fill' | 'bold' }[] = [
  { path: '/', href: '#/', label: 'Home', icon: 'home', style: 'fill' },
  { path: '/subscriptions', href: '#/subscriptions', label: 'Subscriptions', icon: 'subs', style: 'fill' },
  { path: '/search', href: '#/search', label: 'Search', icon: 'search', style: 'bold' },
];
