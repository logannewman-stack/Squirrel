import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { startNative } from "./lib/native";
import { startTheme } from "./lib/theme";
import "./index.css";

// Before React renders, deliberately. Anything that paints first and corrects
// itself a frame later is the flash of the wrong colour everybody notices and
// nobody can quite describe.
startTheme();

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
