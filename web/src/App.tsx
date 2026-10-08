import { useHashRoute } from './hooks/useHashRoute';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { HomePage } from './pages/HomePage';
import { SearchPage } from './pages/SearchPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';

export default function App() {
  const route = useHashRoute();
  return (
    <>
      <div className="mx-auto flex min-h-screen max-w-[1590px] font-sans">
        <Sidebar active={route.path} />
        <main className="min-w-0 flex-1 pb-[72px] sm:pb-0">
          {route.path === '/search' ? (
            <SearchPage key={route.rawHash} />
          ) : route.path === '/subscriptions' ? (
            <SubscriptionsPage />
          ) : (
            <HomePage />
          )}
        </main>
      </div>
      <TabBar active={route.path} />
    </>
  );
}
