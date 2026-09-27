"use client";

import { createPortal } from "react-dom";
import * as React from "react";
import {
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ChangeEventHandler,
  type CSSProperties,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Check, ChevronDown } from "lucide-react";

type SelectOption = {
  key: string;
  value: string;
  label: ReactNode;
  group?: string;
  disabled?: boolean;
};

type ThemedSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  value?: string;
  onChange?: ChangeEventHandler<HTMLSelectElement>;
};

type OptionProps = {
  value?: string | number;
  label?: string;
  disabled?: boolean;
  children?: ReactNode;
};

type GroupProps = {
  label?: string;
  children?: ReactNode;
};

function textFromNode(node: ReactNode): string {
  return ReactNodeToArray(node)
    .map((part) => (typeof part === "string" || typeof part === "number" ? String(part) : ""))
    .join("");
}

function ReactNodeToArray(node: ReactNode): ReactNode[] {
  const result: ReactNode[] = [];
  const visit = (value: ReactNode) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && value !== undefined && typeof value !== "boolean") {
      result.push(value);
    }
  };
  visit(node);
  return result;
}

function collectOptions(children: ReactNode, group?: string, output: SelectOption[] = []): SelectOption[] {
  ReactNodeToArray(children).forEach((child, index) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      const fragmentProps = child.props as { children?: ReactNode };
      collectOptions(fragmentProps.children, group, output);
      return;
    }

    if (child.type === "optgroup") {
      const props = child.props as GroupProps;
      collectOptions(props.children, props.label ?? "", output);
      return;
    }

    if (child.type !== "option") return;
    const props = child.props as OptionProps;
    const label = props.children ?? props.label ?? "";
    const value = props.value === undefined ? textFromNode(label) : String(props.value);
    output.push({
      key: `${group ?? ""}:${value}:${output.length}:${index}`,
      value,
      label,
      group,
      disabled: props.disabled,
    });
  });
  return output;
}

function layoutClasses(className: string): string {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) =>
      /^(?:[a-z-]+:)?(?:w-(?:full|auto|\[[^\]]+\]|\d+\/\d+)|min-w-|max-w-|flex(?:-1)?|grow|shrink(?:-0)?|basis-|self-|inline-flex)/.test(
        token,
      ),
    )
    .join(" ");
}

export function ThemedSelect({
  children,
  className = "",
  value,
  defaultValue,
  onChange,
  disabled,
  id,
  name,
  title,
  ...nativeProps
}: ThemedSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nativeSelectRef = useRef<HTMLSelectElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [internalValue, setInternalValue] = useState(
    value !== undefined ? String(value) : defaultValue !== undefined ? String(defaultValue) : "",
  );

  const options = useMemo(() => collectOptions(children), [children]);
  const selectedValue = value !== undefined ? String(value) : internalValue;
  const selected = options.find((option) => option.value === selectedValue) ?? options[0];
  const layout = layoutClasses(className);
  const listId = `${id ?? name ?? "themed-select"}-options`;

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;
    const rect = trigger.getBoundingClientRect();
    const availableBelow = window.innerHeight - rect.bottom - 16;
    const availableAbove = rect.top - 16;
    const maxHeight = Math.max(144, Math.min(360, Math.max(availableBelow, availableAbove)));
    const estimatedHeight = Math.min(maxHeight, Math.max(52, options.length * 44 + 8));
    const shouldOpenAbove = availableBelow < estimatedHeight && availableAbove > availableBelow;
    setMenuStyle({
      left: rect.left,
      top: shouldOpenAbove ? Math.max(8, rect.top - estimatedHeight - 4) : rect.bottom + 4,
      width: rect.width,
      maxHeight,
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    positionMenu();
    const reposition = () => positionMenu();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, positionMenu]);

  function emitChange(next: SelectOption) {
    if (next.disabled || disabled) return;
    if (value === undefined) setInternalValue(next.value);
    if (nativeSelectRef.current) nativeSelectRef.current.value = next.value;

    const target = nativeSelectRef.current ?? ({ value: next.value } as HTMLSelectElement);
    const event = {
      target,
      currentTarget: target,
    } as ChangeEvent<HTMLSelectElement>;
    onChange?.(event);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const menu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            className="theme-select-menu"
            role="listbox"
            aria-label={title ?? nativeProps["aria-label"] ?? "Options"}
            style={{ ...menuStyle, visibility: menuStyle.width ? "visible" : "hidden" }}
          >
            {options.map((option, index) => {
              const showGroup = option.group && (index === 0 || options[index - 1]?.group !== option.group);
              const active = option.value === selectedValue;
              return (
                <Fragment key={option.key}>
                  {showGroup ? <div className="theme-select-group-label">{option.group}</div> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    aria-disabled={option.disabled || undefined}
                    disabled={option.disabled}
                    className="theme-select-option"
                    onClick={() => emitChange(option)}
                  >
                    <span>{option.label}</span>
                    {active ? <Check className="theme-select-check" aria-hidden="true" /> : null}
                  </button>
                </Fragment>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <span className={`theme-select-wrap ${layout}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={nativeProps["aria-label"]}
        className={`theme-select-trigger relative flex w-full items-center justify-between gap-2 text-left ${className}`}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " " || event.key === "ArrowDown") && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? "Select"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-stone-400 dark:text-slate-400" aria-hidden="true" />
      </button>

      <select
        {...nativeProps}
        ref={nativeSelectRef}
        name={name}
        value={selectedValue}
        onChange={onChange}
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
        className="theme-select-native"
      >
        {children}
      </select>
      {menu}
    </span>
  );
}
