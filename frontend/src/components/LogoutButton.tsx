import { useAuth } from "../auth/AuthContext";

export function LogoutButton() {
  const { logout, logoutError } = useAuth();
  return (
    <div className="logout-control">
      <button
        type="button"
        className="app-shell-icon-btn"
        onClick={() => void logout()}
        aria-label={logoutError ? "重试退出登录" : "退出"}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <span>{logoutError ? "重试退出" : "退出"}</span>
      </button>
      {logoutError && (
        <p className="logout-error" role="alert">
          {logoutError}
        </p>
      )}
    </div>
  );
}
