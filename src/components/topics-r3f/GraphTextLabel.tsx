/**
 * Shared text primitive for graph labels rendered inside R3F.
 * Wraps drei/Text with our default typography and outline settings.
 */

import { Text } from "@react-three/drei";
import { forwardRef } from "react";
import type { ComponentProps } from "react";
import type { Text as TroikaText } from "troika-three-text";

type DreiTextProps = ComponentProps<typeof Text>;

interface TextSegment {
  text: string;
  [key: string]: any;
}

export interface GraphTextLabelProps extends Omit<DreiTextProps, "children"> {
  text?: string;
  textSegments?: TextSegment[];
  color?: string;
  opacity?: number;
}

export const GraphTextLabel = forwardRef<TroikaText, GraphTextLabelProps>(function GraphTextLabel({
  text,
  textSegments,
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
  const resolvedText =
    text ??
    (textSegments ? textSegments.map((segment) => segment?.text ?? "").join("") : undefined);

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
      text={resolvedText}
      {...{ textSegments } as any}
      {...rest}
    />
  );
});
