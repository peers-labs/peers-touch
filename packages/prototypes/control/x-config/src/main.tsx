import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { XConfigPrototype } from "./XConfigPrototype";

createRoot(document.getElementById("root")!).render(
  <StrictMode><XConfigPrototype /></StrictMode>,
);
