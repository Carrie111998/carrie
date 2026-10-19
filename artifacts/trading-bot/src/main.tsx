import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/device"; // start listening for the install prompt early

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(<App />);
