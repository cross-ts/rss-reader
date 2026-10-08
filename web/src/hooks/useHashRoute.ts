import { useEffect, useState } from 'react';

export type RoutePath = '/' | '/search' | '/subscriptions';

export interface Route {
  path: RoutePath;
  params: URLSearchParams;
  rawHash: string;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [p, qs = ''] = raw.split('?');
  const path: RoutePath = p === '/search' || p === '/subscriptions' ? p : '/';
  return { path, params: new URLSearchParams(qs), rawHash: raw };
}

/**
 * ハッシュルーティング。history.replaceState による hash 書き換えは
 * hashchange を発火しないため、検索入力中に再マウントされない。
 */
export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
