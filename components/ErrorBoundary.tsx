'use client';
import React from 'react';

// A minimal reusable error boundary (React error boundaries must be class components).
// Renders `fallback` when a child throws. `resetKey` lets a parent clear the error when
// the relevant inputs change (e.g. a retry that swaps the payload in).
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode; resetKey?: unknown },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }
  componentDidCatch(err: unknown) {
    console.error('[ErrorBoundary]', err);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
