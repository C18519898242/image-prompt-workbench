import { Component, type ErrorInfo, type ReactNode } from "react";

type ViewErrorBoundaryProps = {
  children: ReactNode;
  onReset?: () => void;
};

type ViewErrorBoundaryState = {
  error: Error | null;
};

/** 捕获子树渲染错误，避免整页白屏无提示 */
export class ViewErrorBoundary extends Component<
  ViewErrorBoundaryProps,
  ViewErrorBoundaryState
> {
  state: ViewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ViewErrorBoundary", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="view-error" role="alert">
          <h2>页面加载失败</h2>
          <p>{this.state.error.message || String(this.state.error)}</p>
          {this.props.onReset && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                this.setState({ error: null });
                this.props.onReset?.();
              }}
            >
              返回提示词库
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
