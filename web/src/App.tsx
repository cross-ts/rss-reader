import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './components/Sidebar';
import { ArticleList } from './components/ArticleList';
import { ArticleView } from './components/ArticleView';
import { type Article } from './api/client';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,
    },
  },
});

function AppInner() {
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);

  const handleSelectFolder = (id: number | null) => {
    setSelectedFolderId(id);
    setSelectedFeedId(null);
    setSelectedArticle(null);
  };

  const handleSelectFeed = (id: number | null) => {
    setSelectedFeedId(id);
    setSelectedFolderId(null);
    setSelectedArticle(null);
  };

  const handleSelectArticle = (article: Article) => {
    setSelectedArticle(article);
  };

  return (
    <div className="app-layout">
      <Sidebar
        selectedFolderId={selectedFolderId}
        selectedFeedId={selectedFeedId}
        onSelectFolder={handleSelectFolder}
        onSelectFeed={handleSelectFeed}
      />
      <ArticleList
        folderId={selectedFolderId}
        feedId={selectedFeedId}
        selectedArticleId={selectedArticle?.id ?? null}
        onSelectArticle={handleSelectArticle}
      />
      <ArticleView article={selectedArticle} />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}
