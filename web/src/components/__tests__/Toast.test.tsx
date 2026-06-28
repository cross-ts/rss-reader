import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../Toast';

// Helper component that exposes addToast via buttons
function TestConsumer({
  message = 'Test message',
  type = 'info' as const,
  action,
  duration,
}: {
  message?: string;
  type?: 'success' | 'error' | 'info';
  action?: { label: string; onClick: () => void };
  duration?: number;
}) {
  const { addToast } = useToast();
  return (
    <button onClick={() => addToast(message, type, action, duration)} data-testid="trigger">
      Add Toast
    </button>
  );
}

function renderWithProvider(consumerProps?: Parameters<typeof TestConsumer>[0]) {
  return render(
    <ToastProvider>
      <TestConsumer {...consumerProps} />
    </ToastProvider>,
  );
}

/** Click the trigger button wrapped in act() to avoid warnings from scheduled timers */
function clickTrigger(testId = 'trigger') {
  act(() => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

describe('ToastProvider & useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it('throws when useToast is used outside ToastProvider', () => {
    // Suppress React error boundary console output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow('useToast must be used within ToastProvider');
    spy.mockRestore();
  });

  it('renders a toast when addToast is called', () => {
    renderWithProvider({ message: 'Hello toast' });
    clickTrigger();
    expect(screen.getByText('Hello toast')).toBeInTheDocument();
  });

  it('renders multiple toasts', () => {
    renderWithProvider({ message: 'Toast msg' });
    clickTrigger();
    clickTrigger();
    // Both should be present (each click adds a new toast with unique id)
    expect(screen.getAllByText('Toast msg')).toHaveLength(2);
  });

  it('auto-dismisses toast after default duration (5000ms)', () => {
    renderWithProvider({ message: 'Auto dismiss' });
    clickTrigger();
    expect(screen.getByText('Auto dismiss')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText('Auto dismiss')).not.toBeInTheDocument();
  });

  it('auto-dismisses toast after custom duration', () => {
    renderWithProvider({ message: 'Quick toast', duration: 1000 });
    clickTrigger();
    expect(screen.getByText('Quick toast')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.getByText('Quick toast')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Quick toast')).not.toBeInTheDocument();
  });

  it('dismisses toast when dismiss button is clicked', () => {
    renderWithProvider({ message: 'Dismissable' });
    clickTrigger();
    expect(screen.getByText('Dismissable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Dismissable')).not.toBeInTheDocument();
  });

  it('renders action button when action is provided', () => {
    const actionClick = vi.fn();
    renderWithProvider({
      message: 'With action',
      action: { label: 'Undo', onClick: actionClick },
    });
    clickTrigger();

    const actionBtn = screen.getByText('Undo');
    expect(actionBtn).toBeInTheDocument();
    fireEvent.click(actionBtn);
    expect(actionClick).toHaveBeenCalledTimes(1);
  });

  it('does not render action button when no action is provided', () => {
    renderWithProvider({ message: 'No action' });
    clickTrigger();
    // Only the dismiss button should exist (plus the trigger)
    const buttons = screen.getAllByRole('button');
    // trigger + dismiss = 2
    expect(buttons).toHaveLength(2);
  });

  describe('toast types', () => {
    it('renders success toast with correct styling', () => {
      renderWithProvider({ message: 'Success!', type: 'success' });
      clickTrigger();
      const toastEl = screen.getByText('Success!').closest('div[class*="bg-"]');
      expect(toastEl?.className).toContain('bg-emerald-50');
    });

    it('renders error toast with correct styling', () => {
      renderWithProvider({ message: 'Error!', type: 'error' });
      clickTrigger();
      const toastEl = screen.getByText('Error!').closest('div[class*="bg-"]');
      expect(toastEl?.className).toContain('bg-red-50');
    });

    it('renders info toast with correct styling', () => {
      renderWithProvider({ message: 'Info!', type: 'info' });
      clickTrigger();
      const toastEl = screen.getByText('Info!').closest('div[class*="bg-"]');
      expect(toastEl?.className).toContain('bg-white');
    });

    it('defaults to info type when type is not specified', () => {
      function DefaultConsumer() {
        const { addToast } = useToast();
        return (
          <button onClick={() => addToast('Default type')} data-testid="default-trigger">
            Add
          </button>
        );
      }
      render(
        <ToastProvider>
          <DefaultConsumer />
        </ToastProvider>,
      );
      act(() => {
        fireEvent.click(screen.getByTestId('default-trigger'));
      });
      const toastEl = screen.getByText('Default type').closest('div[class*="bg-"]');
      expect(toastEl?.className).toContain('bg-white');
    });
  });

  it('does not render container when there are no toasts', () => {
    renderWithProvider();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders container with role="status" when toasts exist', () => {
    renderWithProvider({ message: 'Status test' });
    clickTrigger();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('clears timers on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderWithProvider({ message: 'Cleanup test' });
    clickTrigger();
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
