import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@astryxdesign/core/AppShell';
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { Text } from '@astryxdesign/core/Text';
import { api } from './api/client';
import { useHashRoute, type RoutePath } from './hooks/useHashRoute';
import { HomeFilledIcon, HomeIcon, RssIcon, SearchIcon, StackIcon } from './components/icons';
import { HomePage } from './pages/HomePage';
import { SearchPage } from './pages/SearchPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';

function Count({ n }: { n: number | undefined }) {
  if (!n) return null;
  return (
    <Text type="supporting" hasTabularNumbers>
      {n > 999 ? '999+' : n}
    </Text>
  );
}

function Navigation({ path }: { path: RoutePath }) {
  const unread = useQuery({ queryKey: ['unreadCounts'], queryFn: api.getUnreadCounts });
  const feeds = useQuery({ queryKey: ['feeds'], queryFn: api.getFeeds });
  return (
    <SideNav
      header={<SideNavHeading heading="Reader" subheading="RSS / Atom" icon={<RssIcon width={20} height={20} />} headingHref="#/" />}
    >
      <SideNavSection title="メニュー" isHeaderHidden>
        <SideNavItem
          label="ホーム"
          href="#/"
          icon={HomeIcon}
          selectedIcon={HomeFilledIcon}
          isSelected={path === '/'}
          endContent={<Count n={unread.data?.total} />}
        />
        <SideNavItem
          label="購読"
          href="#/subscriptions"
          icon={StackIcon}
          isSelected={path === '/subscriptions'}
          endContent={<Count n={feeds.data?.length} />}
        />
        <SideNavItem label="検索" href="#/search" icon={SearchIcon} isSelected={path === '/search'} />
      </SideNavSection>
    </SideNav>
  );
}

export default function App() {
  const route = useHashRoute();
  return (
    <AppShell height="auto" variant="surface" sideNav={<Navigation path={route.path} />}>
      {route.path === '/search' ? (
        <SearchPage key={route.rawHash} />
      ) : route.path === '/subscriptions' ? (
        <SubscriptionsPage />
      ) : (
        <HomePage />
      )}
    </AppShell>
  );
}
