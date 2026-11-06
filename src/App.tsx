import { Shell } from "./components/layout/Shell";
import { ToastProvider } from "./components/common/Toast";

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
