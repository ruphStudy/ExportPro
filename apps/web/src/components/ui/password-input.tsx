import { Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { Input, type InputProps } from "./input";

export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<InputProps, "type" | "endAdornment">>(
  (props, ref) => {
    const [visible, setVisible] = React.useState(false);
    return (
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        endAdornment={
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            className="pointer-events-auto text-muted-foreground hover:text-foreground"
          >
            {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        }
        {...props}
      />
    );
  },
);
PasswordInput.displayName = "PasswordInput";
