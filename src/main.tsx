import { render } from '@solidjs/web';
import App from './App';
import { installWebviewHardening } from './lib/hardening';
import './index.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Mount target #root is missing — index.html must contain <div id="root"></div>.');
}

// Installed before the first render, and outside the component tree on purpose.
//
// These listeners protect the *document*, not any component: a reload triggered
// while the app is still mounting is exactly as destructive as one triggered
// later, and an error inside `App` must not be able to leave the window
// unguarded. Registering here also keeps the teardown paired with the render
// root's own, so a hot reload disposes both together.
//
// A no-op in development and in a plain browser preview — see the module docs.
const disposeHardening = installWebviewHardening();

const disposeApp = render(() => <App />, root);

// Vite HMR: tear down the previous root before this entry module re-executes,
// so a hot reload never stacks a second app instance — or a second set of
// hardening listeners — on top of the first.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeApp();
    disposeHardening();
  });
}
