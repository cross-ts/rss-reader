import { Columns } from '../components/Columns';
import { ArticleTimeline } from '../components/ArticleTimeline';
import { SearchBox } from '../components/SearchBox';

export function HomePage() {
  return <Columns center={<ArticleTimeline q="" emptyText="記事がありません。" />} right={<SearchBox />} />;
}
