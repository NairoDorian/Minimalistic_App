import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// React 19 + Vite JSX transform does not require importing React explicitly.
// <StrictMode> surfaces double-invoke bugs during development only; the
// production bundle is unaffected. All mount effects are idempotent, so the
// dev-only double mounting is harmless.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
