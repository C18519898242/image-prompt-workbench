import { useAuth } from "../auth/AuthContext";

export function LogoutButton() {
  const { logout, logoutError } = useAuth();
  return (
    <>
      <button type="button" onClick={() => void logout()}>
        {logoutError ? "重试退出登录" : "退出"}
      </button>
      {logoutError && <p role="alert">{logoutError}</p>}
    </>
  );
}
