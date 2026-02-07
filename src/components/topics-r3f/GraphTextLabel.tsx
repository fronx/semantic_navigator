/**
 * Shared text primitive for graph labels rendered inside R3F.
 * Wraps drei/Text with our default typography and outline settings.
 */

import { Text } from "@react-three/drei";
import { forwardRef } from "react";
import type { ComponentProps } from "react";
import type { Text as TroikaText } from "troika-three-text";

type DreiTextProps = ComponentProps<typeof Text>;

export interface GraphTextLabelProps extends Omit<DreiTextProps, "children"> {
  text: string;
  color?: string;
  opacity?: number;
}

export const GraphTextLabel = forwardRef<TroikaText, GraphTextLabelProps>(function GraphTextLabel({
  text,
  color = "#fefce8",
  maxWidth = 400,
  fontSize = 42,
  outlineWidth = 0.08,
  outlineColor = "rgba(15, 23, 42, 0.85)",
  lineHeight = 1.2,
  letterSpacing = -0.01,
  opacity = 1,
  ...rest
}: GraphTextLabelProps, ref) {
  return (
    <Text
      ref={ref}
      anchorX="center"
      anchorY="middle"
      textAlign="center"
      maxWidth={maxWidth}
      fontSize={fontSize}
      color={color}
      outlineWidth={outlineWidth}
      outlineColor={outlineColor}
      strokeWidth={0}
      strokeColor="#0f172a"
      letterSpacing={letterSpacing}
      lineHeight={lineHeight}
      material-opacity={opacity}
      material-toneMapped={false}
      material-transparent
      material-depthTest={false}
      material-depthWrite={false}
      {...rest}
    >
      {text}
    </Text>
  );
});
