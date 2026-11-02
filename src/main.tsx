import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./ui/styles.css";
createRoot(document.getElementById("root")!).render(<App />);
