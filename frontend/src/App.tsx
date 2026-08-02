import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { LoginForm } from "./components/LoginForm";

export default function App() {
  const { token } = useAuth();
  return token ? <AppShell token={token} /> : <LoginForm />;
}
