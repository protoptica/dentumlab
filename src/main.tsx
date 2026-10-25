import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controlled) window.dispatchEvent(new Event("dentum-update"));
    controlled = true;
  });
  navigator.serviceWorker
    .register(import.meta.env.BASE_URL + "sw.js", { updateViaCache: "none" })
    .then((registration) => {
      const update = () => {
        if (document.visibilityState === "visible")
          void registration.update().catch(() => {});
      };
      document.addEventListener("visibilitychange", update);
      window.setInterval(update, 60000);
    })
    .catch(() => {});
}
