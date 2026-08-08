import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { startNative } from "./lib/native";
import "./index.css";

// Holds near-term reminders so they survive the tab being backgrounded. Absent
// or unsupported, everything still works — reminders just stay inside the app.
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

startNative();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
