import React, { useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Picker as NativePicker } from "@react-native-picker/picker";
import type { PickerItemProps, PickerProps } from "@react-native-picker/picker";
import { Check, ChevronDown, X } from "lucide-react-native";
import { useTheme } from "@/context/ThemeContext";
import { fontSize, radius, space } from "@/theme";

type PickerValue = string | number | object;

type ThemedPickerProps<T extends PickerValue = PickerValue> = PickerProps<T> & {
  children?: React.ReactNode;
};

type PickerOption<T extends PickerValue> = Omit<PickerItemProps<T>, "value"> & {
  key: string;
  value: T;
};

/**
 * A theme-safe Picker used by every native screen.
 *
 * The platform Picker is still used on web, where it maps to the browser's
 * select element. On iOS and Android the platform popup is deliberately not
 * used: its dialog is owned by the operating system and can stay white when a
 * user switches the app to dark mode while the device itself is light. The
 * small modal below owns both surfaces instead, so the control and its opened
 * option list use the same palette as the screen that opened them.
 */
function ThemedPicker<T extends PickerValue = PickerValue>(props: ThemedPickerProps<T>) {
  const { colors: c, isDark } = useTheme();
  const [open, setOpen] = useState(false);

  const options = useMemo(() => {
    return React.Children.toArray(props.children).flatMap((child, index) => {
      if (!React.isValidElement<PickerItemProps<T>>(child)) return [];
      const item = child.props;
      return [
        {
          key: String(child.key ?? `${item.value ?? "option"}-${index}`),
          label: item.label ?? String(item.value ?? ""),
          value: (item.value ?? "") as T,
          color: item.color,
          fontFamily: item.fontFamily,
          style: item.style,
          enabled: item.enabled,
          testID: item.testID,
        } satisfies PickerOption<T>,
      ];
    });
  }, [props.children]);

  if (Platform.OS === "web") {
    return <NativePicker {...props}>{props.children}</NativePicker>;
  }

  const selected = options.find((option) => Object.is(option.value, props.selectedValue)) ?? options[0];
  const pickerStyle = StyleSheet.flatten(props.style) as (TextStyle & ViewStyle) | undefined;
  const selectedTextColor = pickerStyle?.color ?? selected?.color ?? c.text;
  const iconColor = typeof props.dropdownIconColor === "number" ? c.textMuted : props.dropdownIconColor ?? c.textMuted;
  const disabled = props.enabled === false;
  const title = props.prompt ?? props.accessibilityLabel ?? "Choose an option";

  function close() {
    if (!disabled) setOpen(false);
  }

  function choose(option: PickerOption<T>, index: number) {
    if (option.enabled === false || disabled) return;
    props.onValueChange?.(option.value, index);
    setOpen(false);
  }

  return (
    <>
      <Pressable
        testID={props.testID}
        onPress={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel ?? title}
        accessibilityState={{ disabled, expanded: open }}
        style={[
          styles.control,
          { backgroundColor: pickerStyle?.backgroundColor ?? "transparent" },
          pickerStyle,
          disabled ? styles.disabled : null,
        ]}
      >
        <Text numberOfLines={props.numberOfLines ?? 1} style={[styles.controlText, { color: selectedTextColor }]}>
          {selected?.label ?? "Select"}
        </Text>
        <ChevronDown size={18} color={iconColor} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={close}
      >
        <Pressable style={styles.backdrop} onPress={close}>
          <View
            style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={[styles.header, { borderBottomColor: c.border }]}>
              <Text style={[styles.headerText, { color: c.text }]} numberOfLines={1}>
                {title}
              </Text>
              <Pressable onPress={close} hitSlop={8} accessibilityLabel={`Close ${title}`}>
                <X size={20} color={c.textMuted} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.optionList}
              contentContainerStyle={styles.optionListContent}
              keyboardShouldPersistTaps="handled"
            >
              {options.map((option, index) => {
                const selectedOption = Object.is(option.value, props.selectedValue);
                const itemDisabled = disabled || option.enabled === false;
                return (
                  <Pressable
                    key={option.key}
                    testID={option.testID}
                    onPress={() => choose(option, index)}
                    disabled={itemDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected: selectedOption, disabled: itemDisabled }}
                    style={[
                      styles.option,
                      { borderBottomColor: c.border },
                      selectedOption ? { backgroundColor: c.activeSoft } : null,
                      itemDisabled ? styles.disabled : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        { color: option.color ?? c.text },
                        option.style,
                      ]}
                    >
                      {option.label}
                    </Text>
                    {selectedOption ? <Check size={18} color={isDark ? "#6EE7B7" : "#047857"} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** Keep the familiar `<Picker.Item />` API at every call site. */
export const Picker = Object.assign(ThemedPicker, {
  Item: NativePicker.Item,
});

const styles = StyleSheet.create({
  control: {
    minHeight: 44,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[3],
  },
  controlText: {
    flex: 1,
    minWidth: 0,
    marginRight: space[2],
    fontSize: fontSize.base,
    fontWeight: "600",
  },
  disabled: { opacity: 0.5 },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[5],
    backgroundColor: "rgba(2,6,23,0.68)",
  },
  sheet: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "78%",
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: radius["2xl"],
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingHorizontal: space[4],
    borderBottomWidth: 1,
  },
  headerText: { flex: 1, fontSize: fontSize.lg, fontWeight: "900" },
  optionList: { flexGrow: 0 },
  optionListContent: { paddingVertical: space[1] },
  option: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: { flex: 1, minWidth: 0, fontSize: fontSize.base, fontWeight: "700" },
});
