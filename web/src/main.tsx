import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { BASE } from "./store.ts";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${BASE}/sw.js`, { updateViaCache: "none" }).catch(() => {
      /* offline support is optional */
    });
  });
}
