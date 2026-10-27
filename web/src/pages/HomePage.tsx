import { useState } from 'react';
import { Columns } from '../components/Columns';
import { SearchBox } from '../components/SearchBox';
import { CaughtUpMock } from '../home/CaughtUpMock';
import { CurrentMock } from '../home/CurrentMock';
import { FeedlyMock } from '../home/FeedlyMock';
import { InboxMock } from '../home/InboxMock';
import { MockSwitcher } from '../home/MockSwitcher';
import { loadMock, saveMock, type MockId } from '../home/mocks';
import { SwipeMock } from '../home/SwipeMock';
import { XMock } from '../home/XMock';

const VIEWS: Record<MockId, () => React.JSX.Element> = {
  current: CurrentMock,
  x: XMock,
  feedly: FeedlyMock,
  caughtup: CaughtUpMock,
  inbox: InboxMock,
  swipe: SwipeMock,
};

export function HomePage({ params = new URLSearchParams() }: { params?: URLSearchParams }) {
  const [mock, setMock] = useState(() => loadMock(params));
  const View = VIEWS[mock];
  return (
    <Columns
      center={
        <>
          <MockSwitcher
            value={mock}
            onChange={(id) => {
              saveMock(id);
              setMock(id);
              window.scrollTo(0, 0);
            }}
          />
          <View key={mock} />
        </>
      }
      right={<SearchBox />}
    />
  );
}
