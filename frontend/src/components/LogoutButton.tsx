import { useAuth } from "../auth/AuthContext";

export function LogoutButton() {
  const { logout } = useAuth();
  return <button type="button" onClick={() => void logout()}>退出</button>;
}
