import { render } from '@solidjs/web';
import App from './App';
import './index.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Mount target #root is missing — index.html must contain <div id="root"></div>.');
}

const dispose = render(() => <App />, root);

// Vite HMR: tear down the previous root before this entry module re-executes,
// so a hot reload never stacks a second app instance on top of the first.
if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
