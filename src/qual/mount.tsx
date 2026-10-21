import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import QualificationApp from './QualificationApp';
import type { QualificationAppProps } from './QualificationApp';

const roots = new WeakMap<Element, Root>();

// 既存の柔整アプリ(CDN版React)とは別のReactで描画するため、専用のルートにマウントする。
function mountQualificationApp(container: Element, props: QualificationAppProps) {
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(<QualificationApp {...props} />);
}

function unmountQualificationApp(container: Element) {
  roots.get(container)?.unmount();
  roots.delete(container);
}

Object.assign(window, { mountQualificationApp, unmountQualificationApp });
