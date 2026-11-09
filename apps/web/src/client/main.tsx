import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("root missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The platform overlay owns sign-in. Reload when the signed-in state flips,
// so the app boots with a fresh token and a fresh session.
let wasSignedIn = Boolean(window.EnnioAuth?.user);
document.addEventListener("ennio:auth:change", (event) => {
  const signedIn = Boolean((event as CustomEvent<{ user?: unknown }>).detail?.user);
  if (signedIn === wasSignedIn) return;
  wasSignedIn = signedIn;
  location.reload();
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
