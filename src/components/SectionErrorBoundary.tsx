"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
  nonce: number;
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null, nonce: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm">
          <p className="font-medium">{this.props.fallbackTitle ?? "Nie udało się wyświetlić tej sekcji"}</p>
          <p className="mt-1 text-muted-foreground">Odśwież albo spróbuj ponownie — koperty i Do rozdzielenia powinny tu wrócić.</p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => this.setState((s) => ({ error: null, nonce: s.nonce + 1 }))}
          >
            Spróbuj ponownie
          </Button>
        </div>
      );
    }

    return <div key={this.state.nonce}>{this.props.children}</div>;
  }
}
