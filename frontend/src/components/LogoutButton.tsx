import { useAuth } from "../auth/AuthContext";

export function LogoutButton() {
  const { logout, logoutError } = useAuth();
  return (
    <div className="logout-control">
      <button
        type="button"
        className="btn btn-ghost app-shell-logout"
        onClick={() => void logout()}
      >
        <svg
          className="app-shell-logout-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M10 7V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-1"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M15 12H4m0 0 3-3m-3 3 3 3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {logoutError ? "重试退出登录" : "退出"}
      </button>
      {logoutError && <p role="alert">{logoutError}</p>}
    </div>
  );
}
