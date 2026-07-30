import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// React 19 + Vite JSX transform does not require importing React explicitly.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
