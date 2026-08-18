import { render } from '@solidjs/web';
import App from './App';
import './index.css';

const dispose = render(() => <App />, document.getElementById('root') as HTMLElement);

export default dispose;
