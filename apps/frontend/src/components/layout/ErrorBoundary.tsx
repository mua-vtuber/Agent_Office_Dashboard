import React from "react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; message: string };

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Unknown error"
    };
  }

  componentDidCatch(error: unknown): void {
    console.error("UI runtime error:", error);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <section>
          <h2>UI Error</h2>
          <p>화면 렌더링 중 오류가 발생했습니다.</p>
          <pre className="panel">{this.state.message}</pre>
        </section>
      );
    }
    return this.props.children;
  }
}
