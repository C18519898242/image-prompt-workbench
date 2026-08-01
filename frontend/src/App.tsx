import { useAuth } from "./auth/AuthContext";
import { LoginForm } from "./components/LoginForm";
import { WelcomeView } from "./components/WelcomeView";

export default function App() {
  const { token } = useAuth();
  return token ? <WelcomeView token={token} /> : <LoginForm />;
}
