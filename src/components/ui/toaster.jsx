import { useToast } from "@/components/ui/use-toast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  // Render the toasts INSIDE ToastViewport so the viewport's positioning
  // (`fixed`, `pointer-events-none` + `[&>*]:pointer-events-auto`) actually
  // applies to them. Previously they were rendered as siblings of the
  // viewport, with positioning supplied by an extra ToastProvider wrapper -
  // that wrapper has been collapsed to a fragment to fix a full-screen
  // click-blocking bug, so the toasts now live where they belong.
  //
  // Filter out toasts whose `open` was set false by DISMISS_TOAST. Without
  // this, dismissed toasts would still render until REMOVE_TOAST fires
  // (TOAST_REMOVE_DELAY ms later) - on this codebase that delay used to
  // be 1000000ms so toasts effectively never disappeared.
  return (
    <ToastProvider>
      <ToastViewport>
        {toasts
          .filter((t) => t.open !== false)
          .map(function ({ id, title, description, action, ...props }) {
          return (
            <Toast
              key={id}
              {...props}
              role="button"
              tabIndex={0}
              onClick={() => dismiss(id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') dismiss(id); }}
              className="cursor-pointer"
            >
              <div className="grid gap-1 pointer-events-none">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && (
                  <ToastDescription>{description}</ToastDescription>
                )}
              </div>
              {action}
              <ToastClose
                onClick={(e) => {
                  // Stop the click from bubbling up to the toast's own
                  // onClick (would also dismiss but with extra noise).
                  e.stopPropagation();
                  dismiss(id);
                }}
              />
            </Toast>
          );
        })}
      </ToastViewport>
    </ToastProvider>
  );
}